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
public class P8SysConfigApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        Environment.SetEnvironmentVariable("ERP_CONFIG_KEY", "test-config-key-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }
    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    // 本地权限种子：系统配置需 打开/保存/删除。
    private void SeedPerms(string user, bool open = false, bool save = false, bool del = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'系统配置'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除])
                    VALUES(@user,N'系统配置',@open,@save,@del)",
            new { user, open, save, del });
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'系统配置'", new { u = user });
    }
    private void CleanupKeys()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [系统配置表] WHERE [键] IN ('P8API1','P8API2')");
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    // ① 无保存权限 → 403
    [SkippableFact]
    public async Task SysConfig_upsert_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p8_ns", open: true, save: false, del: false);
        try
        {
            var resp = await Client(app, "p8_ns").PostAsJsonAsync("/api/sys-config",
                new { 键 = "P8API1", 值 = "v1", 是否加密 = false });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p8_ns"); }
    }

    // ② 生命周期：明文 upsert→get(明文) / 加密 upsert→get(值=null脱敏) / delete→get 404
    [SkippableFact]
    public async Task SysConfig_lifecycle_plain_encrypted_delete()
    {
        using var app = Factory();
        CleanupKeys();
        SeedPerms("p8_full", open: true, save: true, del: true);
        var client = Client(app, "p8_full");
        try
        {
            // 明文
            var s1 = await client.PostAsJsonAsync("/api/sys-config", new { 键 = "P8API1", 值 = "v1", 是否加密 = false });
            Assert.Equal(HttpStatusCode.OK, s1.StatusCode);
            var g1 = await client.GetFromJsonAsync<JsonElement>("/api/sys-config/P8API1");
            Assert.Equal("v1", g1.GetProperty("值").GetString());

            // 加密
            var s2 = await client.PostAsJsonAsync("/api/sys-config", new { 键 = "P8API2", 值 = "sec", 是否加密 = true });
            Assert.Equal(HttpStatusCode.OK, s2.StatusCode);
            var g2 = await client.GetFromJsonAsync<JsonElement>("/api/sys-config/P8API2");
            Assert.Equal(JsonValueKind.Null, g2.GetProperty("值").ValueKind);  // 脱敏

            // 删除
            var d1 = await client.DeleteAsync("/api/sys-config/P8API1");
            Assert.Equal(HttpStatusCode.NoContent, d1.StatusCode);
            var d2 = await client.DeleteAsync("/api/sys-config/P8API2");
            Assert.Equal(HttpStatusCode.NoContent, d2.StatusCode);

            var gone = await client.GetAsync("/api/sys-config/P8API1");
            Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        }
        finally
        {
            CleanupKeys();
            CleanupPerms("p8_full");
        }
    }
}
