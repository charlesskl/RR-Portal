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
public class PurchaseReturnApiTests(DbFixture fx)
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

    private void SeedPerms(string user,
        bool open = true, bool save = false, bool del = false,
        bool price = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'采购退仓单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,N'采购退仓单',@open,@save,@del,@price,@approve,@unapprove)",
            new { user, open, save, del, price, approve, unapprove });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static object Body() => new
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商", 仓库 = P3TestData.仓库,
        明细 = new[]
        {
            new { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10.0 },
            new { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5 },
        }
    };

    [SkippableFact]
    public async Task Create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("prviewer", open: true, save: false);
        var resp = await Client(app, "prviewer").PostAsJsonAsync("/api/purchase-returns", Body());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("prfull", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "prfull");
        var create = await client.PostAsJsonAsync("/api/purchase-returns", Body());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-returns/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/purchase-returns/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-returns/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/purchase-returns/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@n", new { n = 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Detail_masks_price_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("preditor", open: true, save: true, price: true);
        var editor = Client(app, "preditor");
        var create = await editor.PostAsJsonAsync("/api/purchase-returns", Body());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            SeedPerms("prnoprice", open: true, price: false);
            var viewer = Client(app, "prnoprice");
            var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/purchase-returns/{单号}");
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("单头").GetProperty("金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("明细")[0].GetProperty("单价").ValueKind);
            var d2 = await editor.GetFromJsonAsync<JsonElement>($"/api/purchase-returns/{单号}");
            Assert.Equal(10m, d2.GetProperty("明细")[0].GetProperty("单价").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@n", new { n = 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
