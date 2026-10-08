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
public class P7aPayrollApiIntegrationTests(DbFixture fx)
{
    private const string 部门编号 = "P7AD1";
    private const string 员工号 = "P7AE1";

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

    // 本地权限种子：含「单价」列（计件工资按单价权限脱敏）。
    private void SeedPerms(string user, string menu, bool open = true, bool price = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[单价])
                    VALUES(@user,@menu,@open,@price)",
            new { user, menu, open, price });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void SeedData(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(@d,N'裁床部')", new { d = 部门编号 });
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号]) VALUES(@e,N'张三',@d)", new { e = 员工号, d = 部门编号 });
        // 当月审核有效：数量15，金额30
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@e,N'01',10,2,20,'2026-05-10','1','1')", new { e = 员工号 });
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@e,N'02',5,2,10,'2026-05-20','1','1')", new { e = 员工号 });
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [计件表] WHERE [员工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [部门信息] WHERE [编号]=@d", new { d = 部门编号 });
    }
    private void CleanupPerms(params string[] users)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        foreach (var u in users)
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'计件归集'", new { u });
    }

    [SkippableFact]
    public async Task Payroll_forbidden_without_open()
    {
        using var app = Factory();
        // 无「计件归集」打开权限：不种任何行
        var resp = await Client(app, "p7a_no").GetAsync("/api/payroll/piecework?月份=202605");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Payroll_returns_wage_with_open_and_price()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7a_wp", "计件归集", open: true, price: true);
        var client = Client(app, "p7a_wp");
        try
        {
            var rows = await client.GetFromJsonAsync<JsonElement>($"/api/payroll/piecework?{Uri.EscapeDataString("月份")}=202605");
            var row = rows.EnumerateArray().Single(r => r.GetProperty("编号").GetString() == 员工号);
            Assert.Equal(JsonValueKind.Number, row.GetProperty("计件工资").ValueKind);
            Assert.True(row.GetProperty("计件工资").GetDecimal() > 0);
            Assert.Equal(30m, row.GetProperty("计件工资").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7a_wp");
        }
    }

    [SkippableFact]
    public async Task Payroll_strips_wage_without_price()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7a_np", "计件归集", open: true, price: false);
        var client = Client(app, "p7a_np");
        try
        {
            var rows = await client.GetFromJsonAsync<JsonElement>($"/api/payroll/piecework?{Uri.EscapeDataString("月份")}=202605");
            var row = rows.EnumerateArray().Single(r => r.GetProperty("编号").GetString() == 员工号);
            Assert.Equal(JsonValueKind.Null, row.GetProperty("计件工资").ValueKind);
            Assert.Equal(JsonValueKind.Number, row.GetProperty("数量").ValueKind);
            Assert.Equal(15m, row.GetProperty("数量").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7a_np");
        }
    }

    [SkippableFact]
    public async Task Payroll_bad_month_returns_400()
    {
        using var app = Factory();
        SeedPerms("p7a_bm", "计件归集", open: true, price: true);
        try
        {
            var resp = await Client(app, "p7a_bm").GetAsync("/api/payroll/piecework?月份=2026");
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally { CleanupPerms("p7a_bm"); }
    }
}
