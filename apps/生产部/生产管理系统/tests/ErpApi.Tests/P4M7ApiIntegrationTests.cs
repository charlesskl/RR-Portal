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
public class P4M7ApiIntegrationTests(DbFixture fx)
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

    [SkippableFact]
    public async Task OutsourceItem_crud_roundtrip()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]='APITEST车缝'"); }
        SeedPerms("p4osi", "发外加工项目", open: true, save: true, del: true, price: true);
        var client = Client(app, "p4osi");
        try
        {
            var create = await client.PostAsJsonAsync("/api/master/outsource-items", new { 加工项目 = "APITEST车缝", 单价 = 2.5, 备注 = "x" });
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            var list = await client.GetFromJsonAsync<JsonElement>("/api/master/outsource-items?keyword=APITEST车缝");
            Assert.True(list.GetProperty("total").GetInt32() >= 1);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]='APITEST车缝'");
        }
    }

    private static object OutsourceBody() => new
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 = new[]
        {
            new { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 60 },
            new { 加工项目 = P4M7TestData.加工项目, 颜色 = "白色", 尺码 = "L", 数量 = 40 },
        }
    };

    [SkippableFact]
    public async Task Outsource_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4osviewer", "发外加工", open: true, save: false);
        var resp = await Client(app, "p4osviewer").PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Outsource_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4osnoprice", "发外加工", open: true, save: true, price: false);
        var client = Client(app, "p4osnoprice");
        var create = await client.PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Outsource_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4os", "发外加工", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p4os");

        var create = await client.PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var list = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing?keyword={单号}");
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/{单号}");
            Assert.Equal(2, detail.GetProperty("明细").GetArrayLength());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/outsourcing/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/outsourcing/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Outsource_full_loop_dispatch_receive_reconcile()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4loop", "发外加工", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p4loop", "发外回收", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p4loop", "发外对数", open: true, save: false, del: false, price: true);
        var client = Client(app, "p4loop");
        string? fw = null, fh = null;
        try
        {
            var cr = await client.PostAsJsonAsync("/api/outsourcing", new {
                加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
                明细 = new[] { new { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 100 } }
            });
            fw = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{fw}/approve", null)).StatusCode);

            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/returns/basis?发外单号={fw}");
            Assert.Equal(1, basis.GetArrayLength());
            Assert.Equal(100, basis[0].GetProperty("欠数").GetDecimal());

            var rr = await client.PostAsJsonAsync("/api/outsourcing/returns", new {
                发外单号 = fw, 加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                明细 = new[] { new {
                    生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
                    加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 发外数量 = 100, 回收数量 = 95 } }
            });
            Assert.Equal(HttpStatusCode.Created, rr.StatusCode);
            fh = (await rr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/returns/{fh}/approve", null)).StatusCode);

            var rec = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/reconcile?发外单号={fw}");
            Assert.Equal(1, rec.GetArrayLength());
            Assert.Equal(100, rec[0].GetProperty("发外数量").GetDecimal());
            Assert.Equal(95, rec[0].GetProperty("回收数量").GetDecimal());
            Assert.Equal(5, rec[0].GetProperty("相差数量").GetDecimal());
            Assert.Equal(237.5m, rec[0].GetProperty("金额").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (fh != null) { c.Execute("DELETE FROM [发外回收明细单] WHERE [单号]=@n", new { n = fh }); c.Execute("DELETE FROM [发外回收单] WHERE [单号]=@n", new { n = fh }); }
            if (fw != null) { c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = fw }); c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = fw }); }
            P4M7TestData.Cleanup(c);
        }
    }
}
