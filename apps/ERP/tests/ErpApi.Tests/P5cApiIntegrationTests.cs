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
public class P5cApiIntegrationTests(DbFixture fx)
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
    private void SeedPerms(string user, string menu,
        bool open = true, bool save = false, bool del = false,
        bool price = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,@menu,@open,@save,@del,@price,@approve,@unapprove)",
            new { user, menu, open, save, del, price, approve, unapprove });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static object ReceiptBody() => new
    {
        仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
        明细 = new[]
        {
            new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 60, 单价 = 10 },
            new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "白色", 单位 = "件", 数量 = 40, 单价 = 10 },
        }
    };

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk_v", "半成品入仓", open: true, save: false);
        var resp = await Client(app, "p5crk_v").PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Receipt_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk_np", "半成品入仓", open: true, save: true, price: false);
        var client = Client(app, "p5crk_np");
        var create = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/semi-receipts/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle_and_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk", "半成品入仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5crk", "半成品库存", open: true);
        var client = Client(app, "p5crk");
        var create = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>($"/api/semi-receipts?keyword={单号}")).GetProperty("total").GetInt32());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-receipts/{单号}/approve", null)).StatusCode);
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存").GetDecimal();
            Assert.Equal(100m, sum);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/semi-receipts/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-receipts/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/semi-receipts/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Issue_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5cll", "半成品入仓", open: true, save: true, approve: true);
        SeedPerms("p5cll", "半成品领料", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5cll", "半成品库存", open: true);
        // 三级流转角色:p5cll 兼任 装配部(02)主管/经理(部门"车间一"查不到→责任部门退回 02)
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN ('P5CL1','P5CL2')");
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('P5CL1',N'p5cll',N'主管',N'02'),('P5CL2',N'p5cll',N'经理',N'02')");
        }
        var client = Client(app, "p5cll");
        string? rk = null, ll = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-receipts/{rk}/approve", null);
            var ci = await client.PostAsJsonAsync("/api/semi-issues", new {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 领料人 = "张三",
                明细 = new[] { new { 配件编号 = P5cTestData.物料编号, 数量 = 30 } } });
            Assert.Equal(HttpStatusCode.Created, ci.StatusCode);
            ll = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/semi-issues/{ll}/approve", null)).StatusCode);   // 门:未主管/经理审核
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-issues/{ll}/supervisor-approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-issues/{ll}/manager-approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-issues/{ll}/approve", null)).StatusCode);
            Assert.Equal(70m, await Inv());  // 100 - 30
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (ll != null) { c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = ll }); c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = ll }); }
            if (rk != null) { c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN ('P5CL1','P5CL2')");
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FullLoop_receipt_issue_stocktake_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        foreach (var m in new[] { "半成品入仓", "半成品领料", "半成品盘点" })
            SeedPerms("p5cloop", m, open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5cloop", "半成品库存", open: true);
        // 三级流转角色:p5cloop 兼任 装配部(02)主管/经理(部门"车间一"查不到→责任部门退回 02)
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN ('P5CLP1','P5CLP2')");
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('P5CLP1',N'p5cloop',N'主管',N'02'),('P5CLP2',N'p5cloop',N'经理',N'02')");
        }
        var client = Client(app, "p5cloop");
        string? rk = null, ll = null, pd = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-receipts/{rk}/approve", null);
            Assert.Equal(100m, await Inv());

            var ci = await client.PostAsJsonAsync("/api/semi-issues", new {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 领料人 = "张三",
                明细 = new[] { new { 配件编号 = P5cTestData.物料编号, 数量 = 30 } } });
            ll = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-issues/{ll}/supervisor-approve", null);
            await client.PostAsync($"/api/semi-issues/{ll}/manager-approve", null);
            await client.PostAsync($"/api/semi-issues/{ll}/approve", null);
            Assert.Equal(70m, await Inv());

            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/semi-stocktakes/basis?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal basisSum = 0; foreach (var b in basis.EnumerateArray()) basisSum += b.GetProperty("系统数量").GetDecimal();
            Assert.Equal(70m, basisSum);
            var cp = await client.PostAsJsonAsync("/api/semi-stocktakes", new {
                仓库 = P5cTestData.仓库,
                明细 = new[] { new { 配件编号 = P5cTestData.物料编号, 产品装配名称 = "P5c半成品料", 系统数量 = 70, 盘点数量 = 68 } } });
            pd = (await cp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-stocktakes/{pd}/approve", null);
            Assert.Equal(68m, await Inv());  // 70 + (-2)
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (pd != null) { c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [半成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            if (ll != null) { c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = ll }); c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = ll }); }
            if (rk != null) { c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN ('P5CLP1','P5CLP2')");
            P5cTestData.Cleanup(c);
        }
    }
}
