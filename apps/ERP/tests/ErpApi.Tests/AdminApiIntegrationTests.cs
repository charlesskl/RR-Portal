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
public class AdminApiIntegrationTests(DbFixture fx)
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

    // 本地权限种子：给测试用户「账号管理」菜单授权（9位按需置位）。
    private void SeedAdminPerm(string user, bool open = false, bool save = false, bool del = false, bool func = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'账号管理'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[功能])
                    VALUES(@user,@user,N'账号管理',@open,@save,@del,@func)",
            new { user, open, save, del, func });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u", new { u = user });
    }
    private void CleanupAccount(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u", new { u = user });
        c.Execute("DELETE FROM [sysfileuser] WHERE [用户]=@u", new { u = user });
    }

    // ① 无「账号管理」权限 → 全 403
    [SkippableFact]
    public async Task Admin_endpoints_forbidden_without_perm()
    {
        using var app = Factory();
        var client = Client(app, "adm_none");
        try
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/accounts")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await client.PostAsJsonAsync("/api/admin/accounts", new { 用户名 = "X", 初始密码 = "p" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/menus")).StatusCode);
        }
        finally { CleanupPerms("adm_none"); }
    }

    // ② 全生命周期：menus → register → list → save perms → get perms → lock/unlock → delete
    [SkippableFact]
    public async Task Admin_full_lifecycle()
    {
        using var app = Factory();
        SeedAdminPerm("adm_full", open: true, save: true, del: true, func: true);
        var client = Client(app, "adm_full");
        try
        {
            var menus = await client.GetFromJsonAsync<JsonElement>("/api/admin/menus");
            Assert.True(menus.GetArrayLength() > 0);

            var reg = await client.PostAsJsonAsync("/api/admin/accounts", new { 用户名 = "API_U1", 初始密码 = "p1" });
            Assert.Equal(HttpStatusCode.OK, reg.StatusCode);

            var list = await client.GetFromJsonAsync<JsonElement>("/api/admin/accounts?keyword=API_U1");
            Assert.Contains(list.EnumerateArray(), r => r.GetProperty("用户").GetString() == "API_U1");

            var save = await client.PutAsJsonAsync("/api/admin/accounts/API_U1/perms",
                new { 用户名 = "API_U1", 明细 = new[] { new { 菜单 = "客户资料", 打开 = true } } });
            Assert.Equal(HttpStatusCode.NoContent, save.StatusCode);

            var perms = await client.GetFromJsonAsync<JsonElement>("/api/admin/accounts/API_U1/perms");
            var cust = perms.EnumerateArray().Single(r => r.GetProperty("菜单").GetString() == "客户资料");
            Assert.True(cust.GetProperty("打开").GetBoolean());

            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/admin/accounts/API_U1/lock", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/admin/accounts/API_U1/unlock", null)).StatusCode);

            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/admin/accounts/API_U1")).StatusCode);
        }
        finally
        {
            CleanupAccount("API_U1");
            CleanupPerms("adm_full");
        }
    }

    // ③ 自我保护：停用/删除自己 → 400
    [SkippableFact]
    public async Task Admin_self_protection()
    {
        using var app = Factory();
        SeedAdminPerm("adm_full", open: true, save: true, del: true, func: true);
        var client = Client(app, "adm_full");
        try
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/admin/accounts/adm_full/lock", null)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync("/api/admin/accounts/adm_full")).StatusCode);
        }
        finally { CleanupPerms("adm_full"); }
    }
}
