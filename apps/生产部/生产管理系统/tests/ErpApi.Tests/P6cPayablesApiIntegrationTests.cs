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
public class P6cPayablesApiIntegrationTests(DbFixture fx)
{
    private const string 供应商编号 = "P6CC1";

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

    // 本地权限种子：含「金额」列（付款成本保密按金额权限），P6a 共享 SeedPerms 不含金额列故内联。
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
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [供应商资料] WHERE [供应商编号]=@k) INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(@k,N'P6C供应商')", new { k = 供应商编号 });
    }
    private static void CleanupMasters(SqlConnection c)
    {
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=@k", new { k = 供应商编号 });
    }
    private void CleanupPerms(params string[] users)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        foreach (var u in users)
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单] IN (N'采购付款',N'应付对账')", new { u });
    }

    private static object PaymentBody() => new
    {
        明细 = new[]
        {
            new { 供应商编号, 供应商名称 = "P6C供应商", 付款金额 = 30 },
            new { 供应商编号, 供应商名称 = "P6C供应商", 付款金额 = 20 },
        }
    };

    [SkippableFact]
    public async Task Payment_create_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p6c_v", "采购付款", open: true, save: false);
        try
        {
            var resp = await Client(app, "p6c_v").PostAsJsonAsync("/api/purchase-payments", PaymentBody());
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p6c_v"); }
    }

    [SkippableFact]
    public async Task Payment_lifecycle()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6c", "采购付款", open: true, save: true, del: true, amount: true, approve: true, unapprove: true);
        var client = Client(app, "p6c");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/purchase-payments", PaymentBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-payments/{no}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/purchase-payments/{no}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-payments/{no}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/purchase-payments/{no}")).StatusCode);
            no = null;
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [采购付款明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [采购付款单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6c");
        }
    }

    [SkippableFact]
    public async Task Payment_detail_strips_amount_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6c_na", "采购付款", open: true, save: true, amount: false);
        var client = Client(app, "p6c_na");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/purchase-payments", PaymentBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/purchase-payments/{no}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("货款金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("付款金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("尚欠金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [采购付款明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [采购付款单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6c_na");
        }
    }

    [SkippableFact]
    public async Task Payables_supplier_forbidden_without_open()
    {
        using var app = Factory();
        // 无「应付对账」打开权限：不种任何行
        var resp = await Client(app, "p6c_ap_no").GetAsync("/api/payables/supplier");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Payables_supplier_returns_balance_with_open()
    {
        using var app = Factory();
        const string 入仓单号 = "P6CPVG1";
        const string 付款单号 = "P6CPVF1";
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            SeedMasters(c);
            // 采购入仓 100（单头审核）
            c.Execute("INSERT INTO [采购入仓单]([单号],[供应商编号],[供应商名称],[金额],[审核]) VALUES(@n,@k,N'P6C供应商',100,'1')", new { n = 入仓单号, k = 供应商编号 });
            // 采购付款 30（单头审核 + 明细）
            c.Execute("INSERT INTO [采购付款单]([单号],[金额],[审核]) VALUES(@n,30,'1')", new { n = 付款单号 });
            c.Execute("INSERT INTO [采购付款明细单]([单号],[供应商编号],[供应商名称],[付款金额]) VALUES(@n,@k,N'P6C供应商',30)", new { n = 付款单号, k = 供应商编号 });
        }
        SeedPerms("p6c_ap", "应付对账", open: true);
        var client = Client(app, "p6c_ap");
        try
        {
            var rows = await client.GetFromJsonAsync<JsonElement>($"/api/payables/supplier?{Uri.EscapeDataString("供应商编号")}={供应商编号}");
            Assert.Equal(1, rows.GetArrayLength());
            Assert.Equal(供应商编号, rows[0].GetProperty("供应商编号").GetString());
            Assert.Equal(70m, rows[0].GetProperty("应付余额").GetDecimal()); // 100 - 30
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购付款明细单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [采购付款单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 入仓单号 });
            CleanupMasters(c);
            CleanupPerms("p6c_ap");
        }
    }
}
