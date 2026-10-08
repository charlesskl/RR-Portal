using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Linq;
using System.Text.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class P5MonthEndApiIntegrationTests(DbFixture fx)
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

    private void SeedPerms(string user, bool open = true, bool del = true, bool func = true)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'库存月结'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[删除],[功能]) VALUES(@user,N'库存月结',@open,@del,@func)",
            new { user, open, del, func });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private const string wh = "ME_API仓";
    private const string 年月 = "202603";
    private void SeedDocs()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        Clean();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [款号总表] WHERE [款号]=N'MEK') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'MEK',N'演示')");
        c.Execute("INSERT INTO [成品入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'APIR',@d,@wh,'1')", new { d = "2026-03-10", wh });
        c.Execute("INSERT INTO [成品入仓明细单]([单号],[日期],[仓库],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核]) VALUES(N'APIR',@d,@wh,N'MEK',N'演示',N'01',N'黑',N'M',40,'1')", new { d = "2026-03-10", wh });
    }
    private void Clean()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [成品入仓明细单] WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [成品入仓单] WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'MEK'");
    }

    [SkippableFact]
    public async Task Close_without_func_forbidden()
    {
        using var app = Factory();
        SeedDocs();
        SeedPerms("me_nofunc", open: true, del: false, func: false);
        try
        {
            var resp = await Client(app, "me_nofunc").PostAsJsonAsync("/api/month-end/close",
                new { 年月, 口径 = "成品", 仓库 = wh });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task Close_report_reopen_lifecycle()
    {
        using var app = Factory();
        SeedDocs();
        SeedPerms("me_full");
        var client = Client(app, "me_full");
        try
        {
            var close = await client.PostAsJsonAsync("/api/month-end/close", new { 年月, 口径 = "成品", 仓库 = wh });
            Assert.Equal(HttpStatusCode.OK, close.StatusCode);

            var url = $"/api/month-end?{Uri.EscapeDataString("年月")}={年月}&{Uri.EscapeDataString("口径")}={Uri.EscapeDataString("成品")}&{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(wh)}";
            var report = await client.GetFromJsonAsync<JsonElement>(url);
            decimal sum = 0; foreach (var r in report.EnumerateArray()) sum += r.GetProperty("结存").GetDecimal();
            Assert.Equal(40m, sum);

            var dup = await client.PostAsJsonAsync("/api/month-end/close", new { 年月, 口径 = "成品", 仓库 = wh });
            Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);

            var reopen = await client.PostAsJsonAsync("/api/month-end/reopen", new { 年月, 口径 = "成品", 仓库 = wh });
            Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);

            var bad = await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = "2026", 口径 = "成品", 仓库 = wh });
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }
        finally { Clean(); }
    }

    private void SeedPermsPrice(string user, bool price)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'库存月结'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[删除],[功能],[单价]) VALUES(@user,N'库存月结',1,1,1,@price)",
            new { user, price });
    }

    private const string costWh = "ME_API成本仓";
    private void SeedCostDocs()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        CleanCost();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'MMP1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MMP1',N'保密料',N'规Y',N'KG')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'CSTAPI',N'2026-03-10',@wh,'1')", new { wh = costWh });
        c.Execute("INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[金额]) VALUES(N'CSTAPI',N'2026-03-10',@wh,N'MMP1',N'保密料',N'规Y',N'KG',10,5,50)", new { wh = costWh });
    }
    private void CleanCost()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMP1'");
    }

    [SkippableFact]
    public async Task Report_物料金额_按单价权限脱敏()
    {
        using var app = Factory();
        SeedCostDocs();
        try
        {
            SeedPermsPrice("me_cost", price: true);
            var client = Client(app, "me_cost");
            var close = await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = "202603", 口径 = "物料", 仓库 = costWh });
            Assert.Equal(HttpStatusCode.OK, close.StatusCode);

            var url = $"/api/month-end?{Uri.EscapeDataString("年月")}=202603&{Uri.EscapeDataString("口径")}={Uri.EscapeDataString("物料")}&{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(costWh)}";

            var withPrice = await client.GetFromJsonAsync<JsonElement>(url);
            var r0 = withPrice.EnumerateArray().First();
            Assert.Equal(JsonValueKind.Number, r0.GetProperty("加权单价").ValueKind);
            Assert.Equal(5m, r0.GetProperty("加权单价").GetDecimal());

            SeedPermsPrice("me_noprice", price: false);
            var noPrice = await Client(app, "me_noprice").GetFromJsonAsync<JsonElement>(url);
            var n0 = noPrice.EnumerateArray().First();
            Assert.Equal(JsonValueKind.Null, n0.GetProperty("加权单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, n0.GetProperty("结存金额").ValueKind);
            Assert.Equal(10m, n0.GetProperty("结存").GetDecimal());
        }
        finally { CleanCost(); }
    }

    [SkippableFact]
    public async Task 物料_月结后锁期_录入与审核被拒()
    {
        using var app = Factory();
        const string wh = "PL_API物料仓";
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open();
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'PLM1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'PLM1',N'锁料',N'规',N'KG')");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_mat'");
            c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[审核],[反审核],[功能],[单价])
                        VALUES(N'pl_mat',N'采购入仓单',1,1,1,1,1,1,1),(N'pl_mat',N'库存月结',1,1,1,1,1,1,1)");
        }
        var client = Client(app, "pl_mat");
        var ym = DateTime.Now.ToString("yyyyMM");
        string? rk = null;
        try
        {
            var body = new { 仓库 = wh, 明细 = new[] { new { 物料编号 = "PLM1", 物料名称 = "锁料", 规格 = "规", 单位 = "KG", 数量 = 10, 单价 = 5 } } };
            var cr = await client.PostAsJsonAsync("/api/purchase-receipts", body);
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-receipts/{rk}/approve", null)).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = ym, 口径 = "物料", 仓库 = wh })).StatusCode);

            // 反审核该单 → 409
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/purchase-receipts/{rk}/unapprove", null)).StatusCode);
            // 再录入本仓本月单 → 409
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/purchase-receipts", body)).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PLM1'");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_mat'");
        }
    }

    [SkippableFact]
    public async Task 半成品_月结后锁期_审核被拒()
    {
        using var app = Factory();
        const string wh = "PL_API半成品仓";
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open();
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'PLB1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'PLB1',N'半锁料',N'规',N'件')");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_semi'");
            c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[审核],[反审核],[功能],[单价])
                        VALUES(N'pl_semi',N'半成品入仓',1,1,1,1,1,1,1),(N'pl_semi',N'库存月结',1,1,1,1,1,1,1)");
        }
        var client = Client(app, "pl_semi");
        var ym = DateTime.Now.ToString("yyyyMM");
        string? rk = null;
        try
        {
            var body = new { 仓库 = wh, 订单单号 = "PLB-HT", 明细 = new[] { new { 物料编号 = "PLB1", 物料名称 = "半锁料", 规格 = "规", 颜色 = "黑", 单位 = "件", 数量 = 10, 单价 = 5 } } };
            var cr = await client.PostAsJsonAsync("/api/semi-receipts", body);
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-receipts/{rk}/approve", null)).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = ym, 口径 = "半成品", 仓库 = wh })).StatusCode);

            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/semi-receipts/{rk}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/semi-receipts", body)).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PLB1'");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_semi'");
        }
    }

    [SkippableFact]
    public async Task 成品_月结后锁期_审核被拒()
    {
        using var app = Factory();
        const string wh = "PL_API成品仓";
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [成品入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [款号总表] WHERE [款号]=N'PLK1') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'PLK1',N'锁款')");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_fin'");
            c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[审核],[反审核],[功能],[单价])
                        VALUES(N'pl_fin',N'成品入仓',1,1,1,1,1,1,1),(N'pl_fin',N'库存月结',1,1,1,1,1,1,1)");
        }
        var client = Client(app, "pl_fin");
        var ym = DateTime.Now.ToString("yyyyMM");
        string? rk = null;
        try
        {
            // 成品入仓单已改玩具模型(commit 30a5ffce):明细按 配件编号
            var body = new { 仓库 = wh, 明细 = new[] { new { 配件编号 = "PLPJ1", 产品货号 = "PLK1", 产品名称 = "锁款", 数量 = 10, 单价 = 5 } } };
            var cr = await client.PostAsJsonAsync("/api/finished-receipts", body);
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-receipts/{rk}/approve", null)).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = ym, 口径 = "成品", 仓库 = wh })).StatusCode);

            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/finished-receipts/{rk}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/finished-receipts", body)).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [成品入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'PLK1'");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_fin'");
        }
    }
}
