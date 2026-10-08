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
public class P7b2DailyApiIntegrationTests(DbFixture fx)
{
    private const string 员工号 = "API_DE1";
    private const string 班次号 = "ADS1";

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

    private void SeedPerms(string user, string menu, bool open = false, bool save = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[功能])
                    VALUES(@user,@menu,@open,@save,1)",
            new { user, menu, open, save });
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
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(@e,N'接口测试员',N'API_DD1','1')", new { e = 员工号 });
        var sid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
        c.Execute(@"INSERT INTO [考勤_排班表]([排班ID],[识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[迟到分钟],[早退分钟])
VALUES(@sid,@s,N'常日班',
  CAST('1900-01-01 08:00' AS datetime),CAST('1900-01-01 12:00' AS datetime),
  CAST('1900-01-01 13:00' AS datetime),CAST('1900-01-01 17:00' AS datetime),5,5)", new { sid, s = 班次号 });
        var rid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([ID]),0)+1 FROM [排班表]");
        c.Execute("INSERT INTO [排班表]([ID],[工号],[姓名],[日期],[班次]) VALUES(@rid,@e,N'接口测试员',@d0,@s)",
            new { rid, e = 员工号, d0 = new DateTime(2026, 3, 2), s = 班次号 });
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [日报表] WHERE [工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [排班表] WHERE [工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]=@s", new { s = 班次号 });
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=@e", new { e = 员工号 });
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'刷卡录入'", new { u = user });
    }

    // ① 无刷卡录入权限 → GET/POST daily 403
    [SkippableFact]
    public async Task Daily_forbidden_without_perm()
    {
        using var app = Factory();
        var client = Client(app, "p7b2_no");
        var get = await client.GetAsync("/api/attendance/daily?开始=2026-03-02&结束=2026-03-02");
        Assert.Equal(HttpStatusCode.Forbidden, get.StatusCode);
        var post = await client.PostAsJsonAsync("/api/attendance/daily",
            new { 工号 = 员工号, 日期 = "2026-03-02", 刷卡 = new[] { "08:00", "12:00", "13:00", "17:00" } });
        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
    }

    // ② 有权限：save → 200，list 命中 合计时间≈8
    [SkippableFact]
    public async Task Daily_save_then_list()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7b2_full", "刷卡录入", open: true, save: true);
        var client = Client(app, "p7b2_full");
        try
        {
            var save = await client.PostAsJsonAsync("/api/attendance/daily",
                new { 工号 = 员工号, 日期 = "2026-03-02", 刷卡 = new[] { "08:00", "12:00", "13:00", "17:00" } });
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);

            var rows = await client.GetFromJsonAsync<JsonElement>(
                $"/api/attendance/daily?工号={员工号}&开始=2026-03-02&结束=2026-03-02");
            var row = rows.EnumerateArray().Single(r => r.GetProperty("工号").GetString() == 员工号);
            Assert.Equal(8m, row.GetProperty("合计时间").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7b2_full");
        }
    }
}
