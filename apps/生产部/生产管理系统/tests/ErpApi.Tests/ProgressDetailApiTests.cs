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
public class ProgressDetailApiTests(DbFixture fx)
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

    private void SeedPerms(string user, bool open)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'采购订单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开]) VALUES(@user,N'采购订单',@open)",
            new { user, open });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'PDASUP',N'PD-API供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PDAMAT',N'PD-API料',N'米')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'PDAORD', SYSDATETIME(), N'PDASUP', N'PD-API供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'PDAORD',SYSDATETIME(),N'PDAMAT',N'PD-API料',N'红',N'米',100)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'PDARK','2026-03-10','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'PDARK',N'PDAORD',N'PDAMAT',N'红',40)");
    }
    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDAORD'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PDARK'");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDAORD'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDAORD'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDAMAT'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDASUP'");
    }

    [SkippableFact]
    public async Task Detail_forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("pdnoopen", open: false);
        var resp = await Client(app, "pdnoopen").GetAsync("/api/purchase-orders/progress-detail?keyword=PDAMAT");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Detail_returns_row_with_receipt_fields()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        SeedPerms("pdviewer", open: true);
        try
        {
            var rows = await Client(app, "pdviewer")
                .GetFromJsonAsync<JsonElement>("/api/purchase-orders/progress-detail?keyword=PDAMAT");
            Assert.Equal(1, rows.GetArrayLength());
            var r = rows[0];
            Assert.Equal("PDAORD", r.GetProperty("采购单号").GetString());
            Assert.Equal(100m, r.GetProperty("订购数量").GetDecimal());
            Assert.Equal("PDARK", r.GetProperty("入仓单号").GetString());
            Assert.Equal(40m, r.GetProperty("入仓数量").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }
}
