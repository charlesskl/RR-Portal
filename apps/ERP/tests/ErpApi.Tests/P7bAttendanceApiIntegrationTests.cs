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
public class P7bAttendanceApiIntegrationTests(DbFixture fx)
{
    private const string 部门编号 = "P7BD1";
    private const string 员工号 = "P7BE1";

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

    // 本地权限种子：缺勤登记需 打开/保存/删除；出勤汇总需 打开。
    private void SeedPerms(string user, string menu, bool open = false, bool save = false, bool del = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除])
                    VALUES(@user,@menu,@open,@save,@del)",
            new { user, menu, open, save, del });
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
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(@e,N'张三',@d,'1')", new { e = 员工号, d = 部门编号 });
        // 当月缺勤两条（计算出勤为字符串，列 nvarchar(6)），合计 2
        c.Execute("INSERT INTO [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(@e,N'1','2026-05-10')", new { e = 员工号 });
        c.Execute("INSERT INTO [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(@e,N'1','2026-05-20')", new { e = 员工号 });
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [b缺勤登记明细] WHERE [工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [部门信息] WHERE [编号]=@d", new { d = 部门编号 });
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单] IN (N'缺勤登记',N'出勤汇总')", new { u = user });
    }

    // ① 缺勤登记无保存权限 → 403
    [SkippableFact]
    public async Task Absence_create_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p7b_ns", "缺勤登记", open: true, save: false, del: false);
        try
        {
            var resp = await Client(app, "p7b_ns").PostAsJsonAsync("/api/payroll/absences",
                new { 工号 = 员工号, 计算出勤 = 1m, 日期 = "2026-05-10" });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p7b_ns"); }
    }

    // ② 缺勤登记生命周期：create → list(命中) → delete
    [SkippableFact]
    public async Task Absence_lifecycle_create_list_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Cleanup(c); c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(@e,N'张三',@d,'1')", new { e = 员工号, d = 部门编号 }); }
        SeedPerms("p7b_full", "缺勤登记", open: true, save: true, del: true);
        var client = Client(app, "p7b_full");
        try
        {
            var create = await client.PostAsJsonAsync("/api/payroll/absences",
                new { 工号 = 员工号, 登记类型 = "事假", 计算出勤 = 1m, 日期 = "2026-05-10" });
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var created = await create.Content.ReadFromJsonAsync<JsonElement>();
            var id = created.GetProperty("id").GetInt64();
            Assert.True(id > 0);

            var list = await client.GetFromJsonAsync<JsonElement>("/api/payroll/absences?月份=202605&工号=" + 员工号);
            Assert.True(list.GetProperty("total").GetInt32() >= 1);

            var del = await client.DeleteAsync($"/api/payroll/absences/{id}");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7b_full");
        }
    }

    // ③ 出勤汇总无打开 → 403
    [SkippableFact]
    public async Task Attendance_forbidden_without_open()
    {
        using var app = Factory();
        var resp = await Client(app, "p7b_no").GetAsync("/api/payroll/attendance?月份=202605&应出勤天数=26");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // ③ 出勤汇总有打开 → 200，实出勤 = 应出勤 − 缺勤
    [SkippableFact]
    public async Task Attendance_returns_net_with_open()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7b_att", "出勤汇总", open: true);
        var client = Client(app, "p7b_att");
        try
        {
            var rows = await client.GetFromJsonAsync<JsonElement>("/api/payroll/attendance?月份=202605&应出勤天数=26");
            var row = rows.EnumerateArray().Single(r => r.GetProperty("工号").GetString() == 员工号);
            Assert.Equal(26m, row.GetProperty("应出勤天数").GetDecimal());
            Assert.Equal(2m, row.GetProperty("缺勤天数").GetDecimal());
            Assert.Equal(24m, row.GetProperty("实出勤天数").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7b_att");
        }
    }

    // ④ 月份非法 → 400
    [SkippableFact]
    public async Task Attendance_bad_month_returns_400()
    {
        using var app = Factory();
        SeedPerms("p7b_bm", "出勤汇总", open: true);
        try
        {
            var resp = await Client(app, "p7b_bm").GetAsync("/api/payroll/attendance?月份=2026&应出勤天数=26");
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally { CleanupPerms("p7b_bm"); }
    }
}
