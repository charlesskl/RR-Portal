using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class P2ApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    // 9位权限按位授权：打开/保存/删除/单价/审核/反审核
    private void SeedPerms(string user, string menu,
        bool open = true, bool save = false, bool del = false,
        bool price = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,@menu,@open,@save,@del,@price,@approve,@unapprove)",
            new { user, menu, open, save, del, price, approve, unapprove });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static object OrderBody() => new
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        款号 = P2TestData.款号, 款式 = "P2测试款式", 单价 = 100, 仓库 = "成品仓",
        明细 = new[]
        {
            new { 色号 = "C1", 颜色 = "黑色", 尺码 = "S", 数量 = 10 },
            new { 色号 = "C2", 颜色 = "白色", 尺码 = "M", 数量 = 5 },
        }
    };

    [SkippableFact]
    public async Task Order_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2viewer", "成品客户订货单", open: true, save: false);

        var resp = await Client(app, "p2viewer").PostAsJsonAsync("/api/orders", OrderBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_full_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2editor", "成品客户订货单",
            open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p2editor");

        // 创建
        var create = await client.PostAsJsonAsync("/api/orders", OrderBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        // 列表能查到
        var list = await client.GetFromJsonAsync<JsonElement>($"/api/orders?keyword={单号}");
        Assert.Equal(1, list.GetProperty("total").GetInt32());

        // 审核 → 重复审核409 → 已审核删除409 → 反审核 → 可删
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/orders/{单号}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.PostAsync($"/api/orders/{单号}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.DeleteAsync($"/api/orders/{单号}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/orders/{单号}/unapprove", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/orders/{单号}")).StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_approve_forbidden_without_审核_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2saver", "成品客户订货单", open: true, save: true, approve: false);
        var client = Client(app, "p2saver");

        var create = await client.PostAsJsonAsync("/api/orders", OrderBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        var resp = await client.PostAsync($"/api/orders/{单号}/approve", null);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_amounts_masked_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        // 编辑者建单
        SeedPerms("p2editor2", "成品客户订货单", open: true, save: true, price: true);
        var editor = Client(app, "p2editor2");
        var create = await editor.PostAsJsonAsync("/api/orders", OrderBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        // 无"单价"权限者：列表金额/详情单价金额 全部为 null（成本保密后端落实）
        SeedPerms("p2noprice", "成品客户订货单", open: true, price: false);
        var viewer = Client(app, "p2noprice");

        var list = await viewer.GetFromJsonAsync<JsonElement>($"/api/orders?keyword={单号}");
        var row = list.GetProperty("items").EnumerateArray().First();
        Assert.Equal(JsonValueKind.Null, row.GetProperty("金额").ValueKind);

        var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/orders/{单号}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("订货单").GetProperty("金额").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("总表").GetProperty("单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("明细")[0].GetProperty("金额").ValueKind);

        // 有"单价"权限者能看到
        var detail2 = await editor.GetFromJsonAsync<JsonElement>($"/api/orders/{单号}");
        Assert.Equal(100m, detail2.GetProperty("总表").GetProperty("单价").GetDecimal());

        // 清理掉这条未删除的测试订单
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    // 生产通知单（一单多货号）请求体：一个货号 = BOM款号 P2TK01，色码合计 100
    private static object ProductionBody() => new
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
        默认单价 = "HK",
        货号明细 = new[]
        {
            new
            {
                货号 = P2TestData.款号, BOM款号 = P2TestData.款号, 款号名称 = "P2测试款式", 比例 = 1, 分析 = true,
                数量明细 = new[]
                {
                    new { 颜色 = "黑色", 尺码 = "S", 数量 = 50 },
                    new { 颜色 = "白色", 尺码 = "M", 数量 = 50 },
                }
            }
        }
    };

    [SkippableFact]
    public async Task Production_lifecycle_create_detail_approve_with_permissions()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2prod", "生产制单",
            open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        // 反审核直接执行需经理职称(现行「申请→经理批准」流);给测试用户补经理档案
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [人事档案] WHERE [编号]='P2MGR'");
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[职称]) VALUES('P2MGR',N'p2prod',N'经理')");
        }
        var client = Client(app, "p2prod");

        // 创建（算法3+4 自动展开）
        var create = await client.PostAsJsonAsync("/api/production", ProductionBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 生产单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("生产单号").GetString()!;

        // 详情含 工序/物料 展开结果
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/production/{生产单号}");
        Assert.Equal(2, detail.GetProperty("工序").GetArrayLength());
        Assert.Equal(2, detail.GetProperty("物料").GetArrayLength());

        // 审核 → 重复审核409 → 已审核删除409 → 反审核 → 删除
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/production/{生产单号}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.PostAsync($"/api/production/{生产单号}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.DeleteAsync($"/api/production/{生产单号}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/production/{生产单号}/unapprove", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/production/{生产单号}")).StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [人事档案] WHERE [编号]='P2MGR'");
            P2TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Production_prices_masked_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2prodeditor", "生产制单", open: true, save: true, price: true);
        var editor = Client(app, "p2prodeditor");
        var create = await editor.PostAsJsonAsync("/api/production", ProductionBody());
        var 生产单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("生产单号").GetString()!;

        SeedPerms("p2prodviewer", "生产制单", open: true, price: false);
        var viewer = Client(app, "p2prodviewer");

        // 列表：工序单价/物料金额/出货单价 被剥离
        var list = await viewer.GetFromJsonAsync<JsonElement>($"/api/production?keyword={生产单号}");
        var row = list.GetProperty("items").EnumerateArray().First();
        Assert.Equal(JsonValueKind.Null, row.GetProperty("工序单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("物料金额").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("出货单价").ValueKind);

        // 详情：工序.单价 / 物料.预算单价/金额 被剥离
        var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/production/{生产单号}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("工序")[0].GetProperty("单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("物料")[0].GetProperty("预算单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("物料")[0].GetProperty("金额").ValueKind);

        // 有"单价"权限者能看到价格(正向断言：工序单价 = 1.5+2.5 = 4.0)
        var detail2 = await editor.GetFromJsonAsync<JsonElement>($"/api/production/{生产单号}");
        Assert.Equal(4.0m, detail2.GetProperty("单头").GetProperty("工序单价").GetDecimal());

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Production_forbidden_without_permissions()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }

        // 只有打开权限：创建应403
        SeedPerms("p2prodviewer2", "生产制单", open: true, save: false);
        var viewer = Client(app, "p2prodviewer2");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await viewer.PostAsJsonAsync("/api/production", ProductionBody())).StatusCode);

        // 有保存无审核：创建可以,审核应403
        SeedPerms("p2prodsaver", "生产制单", open: true, save: true, approve: false);
        var saver = Client(app, "p2prodsaver");
        var create = await saver.PostAsJsonAsync("/api/production", ProductionBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 生产单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("生产单号").GetString()!;
        Assert.Equal(HttpStatusCode.Forbidden,
            (await saver.PostAsync($"/api/production/{生产单号}/approve", null)).StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }
}
