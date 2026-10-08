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
public class P5bReturnBasisApiTests(DbFixture fx)
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
    private void SeedPerms(string user, string menu, bool open = true, bool price = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,@menu,@open,0,0,@price,0,0)", new { user, menu, open, price });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    [SkippableFact]
    public async Task SalesReturn_basis_masks_price_and_guards_open()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            P5TestData.Seed(c);
            c.Execute(@"INSERT INTO [成品出仓单]([单号],[日期],[客户编号],[客户名称],[仓库],[审核])
                        VALUES(N'RB_API1',GETDATE(),N'P5C01',N'P5测试客户',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[日期],[客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_API1',GETDATE(),N'P5C01',N'P5测试客户',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'01',N'黑色',N'M',10,8,80,'1')");
        }
        try
        {
            // 有 打开+单价 → 200 单价非空
            SeedPerms("rb_api_p", "成品退货", open: true, price: true);
            var withPrice = await Client(app, "rb_api_p").GetFromJsonAsync<JsonElement>("/api/finished-sales-returns/basis?出仓单号=RB_API1");
            Assert.Equal(1, withPrice.GetArrayLength());
            Assert.Equal(JsonValueKind.Number, withPrice[0].GetProperty("单价").ValueKind);
            Assert.Equal("P5K01", withPrice[0].GetProperty("款号").GetString());

            // 仅 打开（无单价）→ 单价 null
            SeedPerms("rb_api_np", "成品退货", open: true, price: false);
            var noPrice = await Client(app, "rb_api_np").GetFromJsonAsync<JsonElement>("/api/finished-sales-returns/basis?出仓单号=RB_API1");
            Assert.Equal(JsonValueKind.Null, noPrice[0].GetProperty("单价").ValueKind);

            // 无 打开 → 403
            SeedPerms("rb_api_no", "成品退货", open: false, price: false);
            var forbid = await Client(app, "rb_api_no").GetAsync("/api/finished-sales-returns/basis?出仓单号=RB_API1");
            Assert.Equal(HttpStatusCode.Forbidden, forbid.StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=N'RB_API1'");
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=N'RB_API1'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task VendorReturn_basis_masks_price_and_guards_open()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            P5TestData.Seed(c);
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'RB_SUP2'");
            c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'RB_SUP2',N'RB测试供应商')");
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[审核])
                        VALUES(N'RB_API2',GETDATE(),N'RB_SUP2',N'RB测试供应商',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_API2',GETDATE(),N'RB_SUP2',N'RB测试供应商',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'01',N'黑色',N'M',12,7,84,'1')");
        }
        try
        {
            SeedPerms("rb_apiv_p", "成品出仓单", open: true, price: true);
            var withPrice = await Client(app, "rb_apiv_p").GetFromJsonAsync<JsonElement>("/api/finished-vendor-returns/basis?入仓单号=RB_API2");
            Assert.Equal(1, withPrice.GetArrayLength());
            Assert.Equal(JsonValueKind.Number, withPrice[0].GetProperty("单价").ValueKind);
            Assert.Equal("RB_SUP2", withPrice[0].GetProperty("供应商编号").GetString());

            SeedPerms("rb_apiv_np", "成品出仓单", open: true, price: false);
            var noPrice = await Client(app, "rb_apiv_np").GetFromJsonAsync<JsonElement>("/api/finished-vendor-returns/basis?入仓单号=RB_API2");
            Assert.Equal(JsonValueKind.Null, noPrice[0].GetProperty("单价").ValueKind);

            SeedPerms("rb_apiv_no", "成品出仓单", open: false, price: false);
            var forbid = await Client(app, "rb_apiv_no").GetAsync("/api/finished-vendor-returns/basis?入仓单号=RB_API2");
            Assert.Equal(HttpStatusCode.Forbidden, forbid.StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=N'RB_API2'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=N'RB_API2'");
            P5TestData.Cleanup(c);
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'RB_SUP2'");
        }
    }
}
