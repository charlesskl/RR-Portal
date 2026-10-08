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
public class P7b2ShiftRosterApiIntegrationTests(DbFixture fx)
{
    private const string 班次 = "AS1";
    private const string 员工号 = "API_E1";

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

    private void SeedPerms(string user, string menu, bool open = false, bool save = false, bool del = false, bool func = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[功能])
                    VALUES(@user,@menu,@open,@save,@del,@func)",
            new { user, menu, open, save, del, func });
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
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单] IN (N'班次管理',N'排班')", new { u = user });
    }
    private static void CleanupData(SqlConnection c)
    {
        c.Execute("DELETE FROM [排班表] WHERE [工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]=@s", new { s = 班次 });
    }

    // ① 无权限用户 → GET shifts / GET rosters → 403
    [SkippableFact]
    public async Task Shifts_and_rosters_forbidden_without_perm()
    {
        using var app = Factory();
        var noShift = await Client(app, "p7b2_no").GetAsync("/api/attendance/shifts");
        Assert.Equal(HttpStatusCode.Forbidden, noShift.StatusCode);
        var noRoster = await Client(app, "p7b2_no").GetAsync("/api/attendance/rosters?开始=2026-03-02&结束=2026-03-02");
        Assert.Equal(HttpStatusCode.Forbidden, noRoster.StatusCode);
    }

    // ② 有权限：班次 save/list/get → 排班 assign/list/remove → 班次删除
    [SkippableFact]
    public async Task Shift_and_roster_lifecycle()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); CleanupData(c); }
        SeedPerms("p7b2_full", "班次管理", open: true, save: true, del: true, func: true);
        SeedPerms("p7b2_full", "排班", open: true, save: true, del: true, func: true);
        var client = Client(app, "p7b2_full");
        try
        {
            // 保存班次
            var save = await client.PostAsJsonAsync("/api/attendance/shifts", new
            {
                识别 = 班次, 名称 = "班", 上午上班 = "08:00", 上午下班 = "12:00",
                下午上班 = "13:00", 下午下班 = "17:00", 总小时 = 8m, 迟到分钟 = 5m, 早退分钟 = 5m
            });
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);

            var list = await client.GetStringAsync("/api/attendance/shifts?keyword=AS1");
            Assert.Contains("AS1", list);

            var get = await client.GetFromJsonAsync<JsonElement>("/api/attendance/shifts/AS1");
            Assert.Equal("08:00", get.GetProperty("上午上班").GetString());

            // seed 员工
            using (var c = new SqlConnection(fx.ConnectionString))
            {
                c.Open();
                c.Execute("INSERT INTO [人事档案]([编号],[姓名],[在职]) VALUES(@e,N'测试',N'1')", new { e = 员工号 });
            }

            // 排班
            var assign = await client.PostAsJsonAsync("/api/attendance/rosters/assign", new
            {
                工号集合 = new[] { 员工号 }, 开始日期 = "2026-03-02", 结束日期 = "2026-03-02", 班次 = 班次
            });
            Assert.Equal(HttpStatusCode.OK, assign.StatusCode);

            var rosters = await client.GetStringAsync("/api/attendance/rosters?开始=2026-03-02&结束=2026-03-02");
            Assert.Contains(员工号, rosters);

            var delRoster = await client.DeleteAsync($"/api/attendance/rosters?工号={员工号}&日期=2026-03-02");
            Assert.Equal(HttpStatusCode.NoContent, delRoster.StatusCode);

            var delShift = await client.DeleteAsync("/api/attendance/shifts/AS1");
            Assert.Equal(HttpStatusCode.NoContent, delShift.StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); CleanupData(c);
            CleanupPerms("p7b2_full");
            CleanupPerms("p7b2_no");
        }
    }
}
