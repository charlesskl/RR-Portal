using System.Net;
using System.Net.Http.Headers;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class P6ApSettlementApiTests(DbFixture fx)
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
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'应付对账'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[金额],[审核],[反审核])
                    VALUES(@user,N'应付对账',@open,0,0,0,0,0)", new { user, open });
    }
    private void CleanupPerms(params string[] users)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        foreach (var u in users)
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'应付对账'", new { u });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    [SkippableFact]
    public async Task Settlement_aging_unpaid_forbidden_without_open()
    {
        using var app = Factory();
        var client = Client(app, "ap_no");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/payables/supplier-settlement")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/payables/supplier-aging")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/api/payables/supplier-unpaid?{Uri.EscapeDataString("供应商编号")}=X")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/payables/factory-settlement")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/payables/factory-aging")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/api/payables/factory-unpaid?{Uri.EscapeDataString("加工厂编号")}=X")).StatusCode);
    }

    [SkippableFact]
    public async Task Settlement_aging_ok_with_open()
    {
        using var app = Factory();
        SeedPerms("ap_ok", open: true);
        try
        {
            var client = Client(app, "ap_ok");
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/payables/supplier-settlement")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/payables/supplier-aging")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/payables/factory-settlement")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/payables/factory-aging")).StatusCode);
        }
        finally { CleanupPerms("ap_ok"); }
    }

    [SkippableFact]
    public async Task Unpaid_requires_code()
    {
        using var app = Factory();
        SeedPerms("ap_un", open: true);
        try
        {
            var client = Client(app, "ap_un");
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/payables/supplier-unpaid")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/payables/factory-unpaid")).StatusCode);
        }
        finally { CleanupPerms("ap_un"); }
    }
}
