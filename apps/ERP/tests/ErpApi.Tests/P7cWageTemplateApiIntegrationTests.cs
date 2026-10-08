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
public class P7cWageTemplateApiIntegrationTests(DbFixture fx)
{
    private const string 模板编号 = "P7CAPI";

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

    // 本地权限种子：工资模板需 打开/保存/删除。
    private void SeedPerms(string user, bool open = false, bool save = false, bool del = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'工资模板'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除])
                    VALUES(@user,N'工资模板',@open,@save,@del)",
            new { user, open, save, del });
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'工资模板'", new { u = user });
    }
    private void CleanupTemplate()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号]=@t", new { t = 模板编号 });
        c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号]=@t", new { t = 模板编号 });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    // ① 无保存权限 → 403
    [SkippableFact]
    public async Task WageTemplate_save_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p7c_ns", open: true, save: false, del: false);
        try
        {
            var resp = await Client(app, "p7c_ns").PostAsJsonAsync("/api/payroll/wage-templates",
                new { 模板编号, 明细 = new[] { new { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" } } });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p7c_ns"); }
    }

    // ② 生命周期：save → get → delete → get(404)
    [SkippableFact]
    public async Task WageTemplate_lifecycle_save_get_delete()
    {
        using var app = Factory();
        CleanupTemplate();
        SeedPerms("p7c_full", open: true, save: true, del: true);
        var client = Client(app, "p7c_full");
        const string 合计公式 = "基本工资+计件工资-社保费";
        try
        {
            var save = await client.PostAsJsonAsync("/api/payroll/wage-templates", new
            {
                模板编号,
                模板名称 = "API车间模板",
                明细 = new[]
                {
                    new { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" },
                    new { 台头项目 = "社保费", 类型 = "应扣", 公式 = "社保费" },
                    new { 台头项目 = "实发合计", 类型 = "合计", 公式 = 合计公式 },
                }
            });
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);

            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/payroll/wage-templates/{模板编号}");
            var 明细 = detail.GetProperty("明细");
            Assert.Equal(3, 明细.GetArrayLength());
            var 合计行 = 明细.EnumerateArray().Single(x => x.GetProperty("台头项目").GetString() == "实发合计");
            Assert.Equal(合计公式, 合计行.GetProperty("公式").GetString());

            var del = await client.DeleteAsync($"/api/payroll/wage-templates/{模板编号}");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

            var gone = await client.GetAsync($"/api/payroll/wage-templates/{模板编号}");
            Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        }
        finally
        {
            CleanupTemplate();
            CleanupPerms("p7c_full");
        }
    }

    // ③ 模板编号空 → 400
    [SkippableFact]
    public async Task WageTemplate_empty_code_returns_400()
    {
        using var app = Factory();
        SeedPerms("p7c_bad", open: true, save: true, del: false);
        try
        {
            var resp = await Client(app, "p7c_bad").PostAsJsonAsync("/api/payroll/wage-templates",
                new { 模板编号 = "", 明细 = new[] { new { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" } } });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally { CleanupPerms("p7c_bad"); }
    }
}
