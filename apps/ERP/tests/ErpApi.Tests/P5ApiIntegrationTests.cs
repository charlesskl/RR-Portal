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
public class P5ApiIntegrationTests(DbFixture fx)
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

    // 成品入仓单已重写为玩具模型(commit 30a5ffce):明细按 配件编号,不再带 色号/尺码;
    // 与服装模型的 成品出仓/库存 不联动(用户确认),故库存断言只看总量。
    private static object ReceiptBody() => new
    {
        仓库 = P5TestData.仓库,
        明细 = new[]
        {
            new { 配件编号 = "P5PJ01", 产品货号 = P5TestData.款号, 产品名称 = "P5测试款式", 生产单号 = P5TestData.生产单号, 数量 = 60, 单价 = 10 },
            new { 配件编号 = "P5PJ02", 产品货号 = P5TestData.款号, 产品名称 = "P5测试款式", 生产单号 = P5TestData.生产单号, 数量 = 40, 单价 = 10 },
        }
    };

    // 服装模型库存链路(出仓/盘点)的入仓基准:成品入仓单 API 已改玩具模型,
    // 故绕过 API 直接种审核过的服装模型入仓单(与 Transfer_lifecycle 测试同法)。
    private static void SeedClothingReceipt(SqlConnection c, string 单号)
    {
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(@n,N'P5成品仓','1')", new { n = 单号 });
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(@n,N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',60,'1')", new { n = 单号 });
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(@n,N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'02',N'白色',N'L',40,'1')", new { n = 单号 });
    }
    private static void DropReceipt(SqlConnection c, string 单号)
    {
        c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
    }

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rkviewer", "成品入仓", open: true, save: false);
        var resp = await Client(app, "p5rkviewer").PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Receipt_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rknoprice", "成品入仓", open: true, save: true, price: false);
        var client = Client(app, "p5rknoprice");
        var create = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/finished-receipts/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle_and_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rk", "成品入仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5rk", "成品库存", open: true);
        var client = Client(app, "p5rk");
        var create = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>($"/api/finished-receipts?keyword={单号}")).GetProperty("total").GetInt32());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-receipts/{单号}/approve", null)).StatusCode);
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存数量").GetDecimal();
            Assert.Equal(100m, sum);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/finished-receipts/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-receipts/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/finished-receipts/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Issue_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); SeedClothingReceipt(c, "P5ISR"); }
        SeedPerms("p5ck", "成品出仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5ck", "成品库存", open: true);
        var client = Client(app, "p5ck");
        string? ck = null;
        try
        {
            var ci = await client.PostAsJsonAsync("/api/finished-issues", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } } });
            Assert.Equal(HttpStatusCode.Created, ci.StatusCode);
            ck = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-issues/{ck}/approve", null)).StatusCode);
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存数量").GetDecimal();
            Assert.Equal(70m, sum);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (ck != null) { c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = ck }); c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = ck }); }
            DropReceipt(c, "P5ISR");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FullLoop_receipt_issue_stocktake_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); SeedClothingReceipt(c, "P5FLR"); }
        foreach (var m in new[] { "成品出仓", "成品盘点" })
            SeedPerms("p5loop", m, open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5loop", "成品库存", open: true);
        var client = Client(app, "p5loop");
        string? ck = null, pd = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存数量").GetDecimal(); return s;
        }
        try
        {
            Assert.Equal(100m, await Inv());

            var ci = await client.PostAsJsonAsync("/api/finished-issues", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } } });
            ck = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-issues/{ck}/approve", null);
            Assert.Equal(70m, await Inv());

            // 入仓两个SKU(01/M=60、02/L=40)、出仓01/M=30 → 系统数量快照合计 = 70
            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/finished-stocktakes/basis?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal basisSum = 0; foreach (var r in basis.EnumerateArray()) basisSum += r.GetProperty("系统数量").GetDecimal();
            Assert.Equal(70m, basisSum);
            // 取 01/M 行(系统30)盘点为28 → 盈亏-2，库存合计 70-2 = 68
            JsonElement line01 = default; bool found = false;
            foreach (var r in basis.EnumerateArray())
                if (r.GetProperty("色号").GetString() == "01" && r.GetProperty("尺码").GetString() == "M") { line01 = r; found = true; break; }
            Assert.True(found);
            Assert.Equal(30m, line01.GetProperty("系统数量").GetDecimal());
            var cp = await client.PostAsJsonAsync("/api/finished-stocktakes", new {
                仓库 = P5TestData.仓库,
                明细 = new[] { new { 款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "M", 系统数量 = 30, 盘点数量 = 28 } } });
            pd = (await cp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-stocktakes/{pd}/approve", null);
            Assert.Equal(68m, await Inv());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (pd != null) { c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            if (ck != null) { c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = ck }); c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = ck }); }
            DropReceipt(c, "P5FLR");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Transfer_lifecycle_moves_inventory_between_warehouses()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c);
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BAPIRK',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BAPIRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')"); }
        SeedPerms("p5btr", "成品调拨", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5btr", "成品库存", open: true);
        var client = Client(app, "p5btr");
        string? cd = null;
        async Task<decimal> Inv(string wh) {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(wh)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存数量").GetDecimal(); return s;
        }
        try
        {
            Assert.Equal(100m, await Inv("P5成品仓"));
            var cr = await client.PostAsJsonAsync("/api/finished-transfers", new {
                源仓库 = "P5成品仓", 目标仓库 = "P5半成品仓",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 10 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            cd = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-transfers/{cd}/approve", null)).StatusCode);
            Assert.Equal(70m, await Inv("P5成品仓"));      // 100-30
            Assert.Equal(30m, await Inv("P5半成品仓"));    // +30
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/finished-transfers/{cd}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-transfers/{cd}/unapprove", null)).StatusCode);
            Assert.Equal(100m, await Inv("P5成品仓"));      // 反审核后回到100
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (cd != null) { c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = cd }); c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = cd }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BAPIRK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BAPIRK'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task SalesReturn_lifecycle_adds_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5bth", "成品退货", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5bth", "成品库存", open: true);
        var client = Client(app, "p5bth");
        string? th = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存数量").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/finished-sales-returns", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 5, 单价 = 20 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            th = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-sales-returns/{th}/approve", null)).StatusCode);
            Assert.Equal(5m, await Inv());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (th != null) { c.Execute("DELETE FROM [成品退货明细单] WHERE [单号]=@n", new { n = th }); c.Execute("DELETE FROM [成品退货单] WHERE [单号]=@n", new { n = th }); }
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task VendorReturn_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c);
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BTCRK',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BTCRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',10,'1')"); }
        SeedPerms("p5btc", "成品出仓单", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5btc", "成品库存", open: true);
        var client = Client(app, "p5btc");
        string? tc = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存数量").GetDecimal(); return s;
        }
        try
        {
            Assert.Equal(10m, await Inv());
            var cr = await client.PostAsJsonAsync("/api/finished-vendor-returns", new {
                仓库 = P5TestData.仓库, 生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 3, 单价 = 10 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            tc = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-vendor-returns/{tc}/approve", null)).StatusCode);
            Assert.Equal(7m, await Inv());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (tc != null) { c.Execute("DELETE FROM [成品退仓明细单] WHERE [单号]=@n", new { n = tc }); c.Execute("DELETE FROM [成品退仓单] WHERE [单号]=@n", new { n = tc }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BTCRK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BTCRK'");
            P5TestData.Cleanup(c);
        }
    }
}
