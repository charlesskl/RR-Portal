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
public class P6aSalesApiIntegrationTests(DbFixture fx)
{
    private const string 客户编号 = "P6AC1";
    private const string 物料编号 = "P6AM1";

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

    private static void SeedMasters(SqlConnection c)
    {
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=@k) INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(@k,N'P6A客户')", new { k = 客户编号 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=@m) INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(@m,N'成品甲',N'M',N'件')", new { m = 物料编号 });
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
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单] IN (N'销售出货',N'销售退货')", new { u });
    }

    private static object ShipmentBody() => new
    {
        仓库 = "P6A仓", 客户编号, 客户名称 = "P6A客户",
        明细 = new[]
        {
            new { 物料编号, 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 10, 单价 = 8 },
            new { 物料编号, 物料名称 = "成品甲", 规格 = "L", 颜色 = "白", 单位 = "件", 数量 = 5, 单价 = 8 },
        }
    };

    [SkippableFact]
    public async Task Shipment_create_forbidden_without_save()
    {
        using var app = Factory();
        SeedPerms("p6a_v", "销售出货", open: true, save: false);
        try
        {
            var resp = await Client(app, "p6a_v").PostAsJsonAsync("/api/sales-shipments", ShipmentBody());
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { CleanupPerms("p6a_v"); }
    }

    [SkippableFact]
    public async Task Shipment_lifecycle()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6a", "销售出货", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p6a");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-shipments", ShipmentBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

            Assert.True((await client.GetFromJsonAsync<JsonElement>($"/api/sales-shipments?keyword={no}")).GetProperty("total").GetInt32() >= 1);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/sales-shipments/{no}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/sales-shipments/{no}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/sales-shipments/{no}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/sales-shipments/{no}")).StatusCode);
            no = null;
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6a");
        }
    }

    [SkippableFact]
    public async Task Shipment_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6a_np", "销售出货", open: true, save: true, price: false);
        var client = Client(app, "p6a_np");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-shipments", ShipmentBody());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/sales-shipments/{no}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("库存单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("库存金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6a_np");
        }
    }

    [SkippableFact]
    public async Task Shipment_detail_shows_price_with_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); SeedMasters(c); }
        SeedPerms("p6a_wp", "销售出货", open: true, save: true, price: true);
        var client = Client(app, "p6a_wp");
        string? no = null;
        try
        {
            var create = await client.PostAsJsonAsync("/api/sales-shipments", ShipmentBody());
            no = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/sales-shipments/{no}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Number, line0.GetProperty("单价").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (no != null) { c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = no }); c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = no }); }
            CleanupMasters(c);
            CleanupPerms("p6a_wp");
        }
    }

    [SkippableFact]
    public async Task Return_references_销售单号_and_basis()
    {
        using var app = Factory();
        const string 销售单号 = "XSP6ABASE1";
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            SeedMasters(c);
            // 造一张销售出货作基准源
            c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(@n,N'P6A仓',@k,N'P6A客户',10,80,'1')", new { n = 销售单号, k = 客户编号 });
            c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额]) VALUES(@n,N'P6A仓',@k,N'P6A客户',@m,N'成品甲',N'M',N'黑',N'件',10,8,80)", new { n = 销售单号, k = 客户编号, m = 物料编号 });
        }
        SeedPerms("p6a_r", "销售退货", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p6a_r");
        string? rno = null;
        try
        {
            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/sales-returns/basis?{Uri.EscapeDataString("销售单号")}={销售单号}");
            Assert.Equal(1, basis.GetArrayLength());
            Assert.Equal(10m, basis[0].GetProperty("数量").GetDecimal());

            var create = await client.PostAsJsonAsync("/api/sales-returns", new
            {
                仓库 = "P6A仓", 销售单号, 客户编号, 客户名称 = "P6A客户",
                明细 = new[] { new { 物料编号, 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 3, 单价 = 8 } }
            });
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            rno = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/sales-returns/{rno}");
            Assert.Equal(销售单号, detail.GetProperty("单头").GetProperty("销售单号").GetString());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (rno != null) { c.Execute("DELETE FROM [销售退货明细单] WHERE [单号]=@n", new { n = rno }); c.Execute("DELETE FROM [销售退货单] WHERE [单号]=@n", new { n = rno }); }
            c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = 销售单号 });
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = 销售单号 });
            CleanupMasters(c);
            CleanupPerms("p6a_r");
        }
    }
}
