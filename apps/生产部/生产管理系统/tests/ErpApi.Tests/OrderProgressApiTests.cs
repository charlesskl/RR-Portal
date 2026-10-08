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
public class OrderProgressApiTests(DbFixture fx)
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
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'OPSAPI',N'API进度供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMAPI',N'API进度料',N'规格API',N'米')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POPRAPI', SYSDATETIME(), N'OPSAPI', N'API进度供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'POPRAPI',SYSDATETIME(),N'OPMAPI',N'API进度料',N'红',N'米',100)");
    }
    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPRAPI'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPRAPI'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMAPI'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'OPSAPI'");
    }

    [SkippableFact]
    public async Task Progress_forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("opnoopen", open: false);
        var resp = await Client(app, "opnoopen").GetAsync("/api/purchase-orders/progress?keyword=OPMAPI");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Progress_returns_rows_with_owed()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        SeedPerms("opviewer", open: true);
        try
        {
            var rows = await Client(app, "opviewer")
                .GetFromJsonAsync<JsonElement>("/api/purchase-orders/progress?keyword=OPMAPI");
            Assert.Equal(1, rows.GetArrayLength());
            var r = rows[0];
            Assert.Equal("POPRAPI", r.GetProperty("采购单号").GetString());
            Assert.Equal(100m, r.GetProperty("订购数量").GetDecimal());
            Assert.Equal(0m, r.GetProperty("入仓数量").GetDecimal());
            Assert.Equal(100m, r.GetProperty("欠数").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }
}
