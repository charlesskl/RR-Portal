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
public class P4ApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

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

    private static object CuttingBody() => new
    {
        生产单号 = P4TestData.生产单号, 货号 = P4TestData.货号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
        客户编号 = P4TestData.客户编号, 客户名称 = "P4测试客户",
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 床号 = "1", 布种 = "全棉",
        明细 = new[]
        {
            new { 扎号 = 1, 缸号 = "G1", 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new { 扎号 = 2, 缸号 = "G1", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        }
    };

    [SkippableFact]
    public async Task Cutting_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4cbviewer", "裁床单", open: true, save: false);
        var resp = await Client(app, "p4cbviewer").PostAsJsonAsync("/api/cuttings", CuttingBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Cutting_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4cb", "裁床单", open: true, save: true, del: true, approve: true, unapprove: true);
        var client = Client(app, "p4cb");

        var create = await client.PostAsJsonAsync("/api/cuttings", CuttingBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 裁床单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("裁床单号").GetString()!;
        try
        {
            var list = await client.GetFromJsonAsync<JsonElement>($"/api/cuttings?keyword={裁床单号}");
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/cuttings/{裁床单号}");
            Assert.Equal(2, detail.GetProperty("明细").GetArrayLength());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/cuttings/{裁床单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/cuttings/{裁床单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/cuttings/{裁床单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/cuttings/{裁床单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
        }
    }

    private static object PieceworkBody() => new
    {
        生产单号 = P4TestData.生产单号, 床号 = "1",
        明细 = new[]
        {
            new { 工序号 = "02", 货号 = P4TestData.货号, 员工号 = P4TestData.员工号, 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new { 工序号 = "02", 货号 = P4TestData.货号, 员工号 = P4TestData.员工号, 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        }
    };

    [SkippableFact]
    public async Task Piecework_record_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4pwviewer", "计件", open: true, save: false);
        var resp = await Client(app, "p4pwviewer").PostAsJsonAsync("/api/piecework", PieceworkBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Piecework_record_approve_and_amounts_masked_without_单价()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4pw", "计件", open: true, save: true, del: true, price: true, approve: true);
        var editor = Client(app, "p4pw");
        try
        {
            var rec = await editor.PostAsJsonAsync("/api/piecework", PieceworkBody());
            Assert.Equal(HttpStatusCode.Created, rec.StatusCode);
            Assert.Equal(2, (await rec.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("录入条数").GetInt32());

            // 有"单价"权限：查询能看到单价/金额
            var list = await editor.GetFromJsonAsync<JsonElement>($"/api/piecework?生产单号={P4TestData.生产单号}");
            Assert.Equal(2, list.GetArrayLength());
            Assert.Equal(2.5m, list[0].GetProperty("单价").GetDecimal());

            // 批量审核
            Assert.Equal(HttpStatusCode.NoContent,
                (await editor.PostAsync($"/api/piecework/approve?生产单号={P4TestData.生产单号}", null)).StatusCode);

            // 无"单价"权限：单价/金额被剥离
            SeedPerms("p4pwnoprice", "计件", open: true, price: false);
            var viewer = Client(app, "p4pwnoprice");
            var masked = await viewer.GetFromJsonAsync<JsonElement>($"/api/piecework?生产单号={P4TestData.生产单号}");
            Assert.Equal(JsonValueKind.Null, masked[0].GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, masked[0].GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); P4TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Piecework_summary_groups_by_worker_and_masks_amount()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        // 录入并审核计件
        SeedPerms("p4sumrec", "计件", open: true, save: true, approve: true, price: true);
        var rec = Client(app, "p4sumrec");
        try
        {
            await rec.PostAsJsonAsync("/api/piecework", PieceworkBody());
            await rec.PostAsync($"/api/piecework/approve?生产单号={P4TestData.生产单号}", null);

            // 无"计件汇总"菜单打开权限 → 403（只给了"计件"菜单）
            SeedPerms("p4sumdenied", "计件", open: true);
            var denied = Client(app, "p4sumdenied");
            Assert.Equal(HttpStatusCode.Forbidden,
                (await denied.GetAsync($"/api/piecework/summary?生产单号={P4TestData.生产单号}")).StatusCode);

            // 有"计件汇总"+"单价"权限 → 看到归集金额 175
            SeedPerms("p4sum", "计件汇总", open: true, price: true);
            var viewer = Client(app, "p4sum");
            var sum = await viewer.GetFromJsonAsync<JsonElement>($"/api/piecework/summary?生产单号={P4TestData.生产单号}");
            var row = sum.EnumerateArray().First();
            Assert.Equal(P4TestData.员工号, row.GetProperty("员工号").GetString());
            Assert.Equal(70m, row.GetProperty("数量").GetDecimal());
            Assert.Equal(175m, row.GetProperty("金额").GetDecimal());

            // 有"计件汇总"但无"单价" → 金额脱敏
            SeedPerms("p4sumnoprice", "计件汇总", open: true, price: false);
            var np = Client(app, "p4sumnoprice");
            var sum2 = await np.GetFromJsonAsync<JsonElement>($"/api/piecework/summary?生产单号={P4TestData.生产单号}");
            Assert.Equal(JsonValueKind.Null, sum2.EnumerateArray().First().GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); P4TestData.Cleanup(c);
        }
    }
}
