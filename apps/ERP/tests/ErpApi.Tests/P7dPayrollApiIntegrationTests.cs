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
public class P7dPayrollApiIntegrationTests(DbFixture fx)
{
    private const string 部门编号 = "P7DAD1";
    private const string 员工号 = "P7DAE1";
    private const string 模板编号 = "P7DAT1";
    private const string 模板坏 = "P7DAT2";
    private const string 月份 = "202605";

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

    // 本地权限种子：工资表需 打开/删除/功能。
    private void SeedPerms(string user, bool open = false, bool del = false, bool 功能 = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'工资表'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[删除],[功能])
                    VALUES(@user,N'工资表',@open,@del,@功能)",
            new { user, open, del, 功能 });
    }
    private void CleanupPerms(string user)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'工资表'", new { u = user });
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
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(@d,N'车间')", new { d = 部门编号 });
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[职称],[基本工资],[在职]) VALUES(@e,N'张三',@d,N'工人',1000,N'1')",
            new { e = 员工号, d = 部门编号 });
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@e,N'01',1,500,500,'2026-05-10','1','1')",
            new { e = 员工号 });
        // 好模板 P7DAT1：4 项 → 应发1760/应扣100/实发1660
        var 项 = new (int 序号, string 台头项目, string 类型, string 公式)[]
        {
            (1, "基本工资", "应发", "基本工资"),
            (2, "计件工资", "应发", "计件工资"),
            (3, "满勤奖", "应发", "实出勤天数/应出勤天数*260"),
            (4, "社保", "应扣", "100"),
        };
        foreach (var (序号, 台头项目, 类型, 公式) in 项)
        {
            c.Execute("INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型]) VALUES(@m,N'车间模板',@序号,@台头项目,@类型)",
                new { m = 模板编号, 序号, 台头项目, 类型 });
            c.Execute("INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式]) VALUES(@m,N'车间模板',NULL,NULL,@序号,@台头项目,@公式)",
                new { m = 模板编号, 序号, 台头项目, 公式 });
        }
        // 坏模板 P7DAT2：公式引用未知变量
        c.Execute("INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型]) VALUES(@m,N'坏模板',1,N'神秘',N'应发')",
            new { m = 模板坏 });
        c.Execute("INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式]) VALUES(@m,N'坏模板',NULL,NULL,1,N'神秘',N'不存在的变量')",
            new { m = 模板坏 });
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [工资明细表] WHERE [月份]=@mo AND [部门编号]=@d", new { mo = 月份, d = 部门编号 });
        c.Execute("DELETE FROM [工资总表] WHERE [月份]=@mo AND [部门编号]=@d", new { mo = 月份, d = 部门编号 });
        c.Execute("DELETE FROM [工资表项目公式] WHERE [月份]=@mo AND [部门编号]=@d", new { mo = 月份, d = 部门编号 });
        c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号] IN (@m1,@m2)", new { m1 = 模板编号, m2 = 模板坏 });
        c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号] IN (@m1,@m2)", new { m1 = 模板编号, m2 = 模板坏 });
        c.Execute("DELETE FROM [计件表] WHERE [员工号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=@e", new { e = 员工号 });
        c.Execute("DELETE FROM [部门信息] WHERE [编号]=@d", new { d = 部门编号 });
    }

    // ① 无功能权限 generate → 403
    [SkippableFact]
    public async Task Generate_forbidden_without_功能()
    {
        using var app = Factory();
        SeedPerms("p7d_ns", open: true, del: true, 功能: false);
        try
        {
            var resp = await Client(app, "p7d_ns").PostAsJsonAsync("/api/payroll/wages",
                new { 月份, 部门编号, 模板编号, 应出勤天数 = 26m });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p7d_ns"); }
    }

    // ② 全权限生命周期：generate → list(命中) → detail(项目映射ZG+明细实发1660) → delete → detail 404
    [SkippableFact]
    public async Task Lifecycle_generate_list_detail_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7d_full", open: true, del: true, 功能: true);
        var client = Client(app, "p7d_full");
        try
        {
            var gen = await client.PostAsJsonAsync("/api/payroll/wages",
                new { 月份, 部门编号, 模板编号, 应出勤天数 = 26m });
            Assert.Equal(HttpStatusCode.OK, gen.StatusCode);
            var no = (await gen.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("工资表编号").GetString();
            Assert.False(string.IsNullOrWhiteSpace(no));

            var list = await client.GetFromJsonAsync<JsonElement>($"/api/payroll/wages?月份={月份}&部门编号={部门编号}");
            Assert.Contains(list.EnumerateArray(), r => r.GetProperty("工资表编号").GetString() == no);

            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/payroll/wages/{no}");
            // 项目映射：满勤奖 列名 → 台头项目
            var 项目 = detail.GetProperty("项目").EnumerateArray().ToList();
            var 满勤 = 项目.Single(p => p.GetProperty("台头项目").GetString() == "满勤奖");
            var 满勤列 = 满勤.GetProperty("列名").GetString()!;
            // 明细行：实发1660，且动态列含满勤奖=260
            var 明细 = detail.GetProperty("明细").EnumerateArray()
                .Single(r => r.GetProperty("编号").GetString() == 员工号);
            Assert.Equal(1660m, 明细.GetProperty("实发合计").GetDecimal());
            Assert.Equal(260m, 明细.GetProperty(满勤列).GetDecimal());

            var del = await client.DeleteAsync($"/api/payroll/wages/{no}");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

            var after = await client.GetAsync($"/api/payroll/wages/{no}");
            Assert.Equal(HttpStatusCode.NotFound, after.StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7d_full");
        }
    }

    // ③ 公式引用未知变量 → 400(消息含 公式错误)
    [SkippableFact]
    public async Task Generate_bad_formula_returns_400()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedData(c); }
        SeedPerms("p7d_bf", open: true, del: true, 功能: true);
        var client = Client(app, "p7d_bf");
        try
        {
            var resp = await client.PostAsJsonAsync("/api/payroll/wages",
                new { 月份, 部门编号, 模板编号 = 模板坏, 应出勤天数 = 26m });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("公式错误", body.GetProperty("消息").GetString());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); Cleanup(c);
            CleanupPerms("p7d_bf");
        }
    }
}
