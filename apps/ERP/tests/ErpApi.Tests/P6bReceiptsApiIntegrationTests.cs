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
public class P6bReceiptsApiIntegrationTests(DbFixture fx)
{
    private const string 客户编号 = "P6BC1";
    private const string 物料编号 = "P6BM1";

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

    // 本地权限种子：含「金额」列（收款成本保密按金额权限），P6a 共享 SeedPerms 不含金额列故内联。
    private void SeedPerms(string user, string menu,
        bool open = true, bool save = false, bool del = false,
        bool amount = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[金额],[审核],[反审核])
                    VALUES(@user,@menu,@open,@save,@del,@amount,@approve,@unapprove)",
            new { user, menu, open, save, del, amount, approve, unapprove });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void SeedMasters(SqlConnection c)
    {
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=@k) INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(@k,N'P6B客户')", new { k = 客户编号 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=@m) INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(@m,N'成品乙',N'M',N'件')", new { m = 物料编号 });
    }
    private static void CleanupMasters(SqlConnection c)
    {
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@m", new { m = 物料编号 });
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=@k", new { k = 客户编号 });
    }
    private void CleanupPerms(params string[] users)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        foreach (var u in users)
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单] IN (N'销售收款',N'应收对账')", new { u });
    }

    private static object ReceiptBody() => new
    {
        明细 = new[]
        {
            new { 客户编号, 客户名称 = "P6B客户", 收款金额 = 30 },
            new { 客户编号, 客户名称 = "P6B客户", 收款金额 = 20 },
        }
    };

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p6b_v", "销售收款", open: true, save: false);
        try
        {
            var resp = await Client(app, "p6b_v").PostAsJsonAsync("/api/sales-receipts", ReceiptBody());
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p6b_v"); }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6b", "销售收款", open: true, save: true, del: true, amount: true, approve: true, unapprove: true);
        var client = Client(app, "p6b");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-receipts", ReceiptBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/sales-receipts/{no}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/sales-receipts/{no}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/sales-receipts/{no}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/sales-receipts/{no}")).StatusCode);
            no = null;
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6b");
        }
    }

    [SkippableFact]
    public async Task Receipt_detail_strips_amount_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6b_na", "销售收款", open: true, save: true, amount: false);
        var client = Client(app, "p6b_na");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-receipts", ReceiptBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/sales-receipts/{no}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("货款金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("收款金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("应收金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6b_na");
        }
    }

    [SkippableFact]
    public async Task Receipt_detail_shows_amount_with_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6b_wa", "销售收款", open: true, save: true, amount: true);
        var client = Client(app, "p6b_wa");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-receipts", ReceiptBody());
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/sales-receipts/{no}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Number, line0.GetProperty("收款金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6b_wa");
        }
    }

    [SkippableFact]
    public async Task Receivables_forbidden_without_open()
    {
        using var app = Factory();
        // 无「应收对账」打开权限：不种任何行
        var resp = await Client(app, "p6b_ro_no").GetAsync("/api/receivables");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Receivables_returns_balance_with_open()
    {
        using var app = Factory();
        const string 出货单号 = "P6BRVS1";
        const string 收款单号 = "P6BRVK1";
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            SeedMasters(c);
            // 出货 100（审核）
            c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(@n,N'P6B仓',@k,N'P6B客户',10,100,'1')", new { n = 出货单号, k = 客户编号 });
            c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额]) VALUES(@n,N'P6B仓',@k,N'P6B客户',@m,N'成品乙',N'M',N'黑',N'件',10,10,100)", new { n = 出货单号, k = 客户编号, m = 物料编号 });
            // 收款 30（审核）
            c.Execute("INSERT INTO [销售收款单]([单号],[金额],[审核]) VALUES(@n,30,'1')", new { n = 收款单号 });
            c.Execute("INSERT INTO [销售收款明细单]([单号],[客户编号],[客户名称],[收款金额]) VALUES(@n,@k,N'P6B客户',30)", new { n = 收款单号, k = 客户编号 });
        }
        SeedPerms("p6b_ro", "应收对账", open: true);
        var client = Client(app, "p6b_ro");
        try
        {
            var rows = await client.GetFromJsonAsync<JsonElement>($"/api/receivables?{Uri.EscapeDataString("客户编号")}={客户编号}");
            Assert.Equal(1, rows.GetArrayLength());
            Assert.Equal(客户编号, rows[0].GetProperty("客户编号").GetString());
            Assert.Equal(70m, rows[0].GetProperty("应收余额").GetDecimal()); // 100 - 30
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@n", new { n = 收款单号 });
            c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@n", new { n = 收款单号 });
            c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = 出货单号 });
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = 出货单号 });
            CleanupMasters(c);
            CleanupPerms("p6b_ro");
        }
    }
}
