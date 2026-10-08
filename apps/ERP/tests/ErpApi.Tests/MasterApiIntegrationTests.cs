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
public class MasterApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?> {
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private void SeedPerms(string user, bool canSave)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除])
                    VALUES(@user,N'客户资料',1,@canSave,1)", new { user, canSave });
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    [SkippableFact]
    public async Task List_requires_open_permission_and_returns_data()
    {
        using var app = Factory();
        SeedPerms("p1viewer", canSave: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1viewer"));

        var resp = await client.GetAsync("/api/master/customers?page=1&size=5");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Create_forbidden_without_save_permission()
    {
        using var app = Factory();
        SeedPerms("p1viewer", canSave: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1viewer"));

        var resp = await client.PostAsJsonAsync("/api/master/customers",
            new { 客户编号 = "INT1", 客户名称 = "应被拒" });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Create_succeeds_with_save_permission_and_writes_audit()
    {
        using var app = Factory();
        SeedPerms("p1editor", canSave: true);
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='INT2'");
            c.Execute("DELETE FROM [c操作记录] WHERE [操作员]='p1editor' AND [表名]=N'客户资料'");
        }
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1editor"));

        var resp = await client.PostAsJsonAsync("/api/master/customers",
            new { 客户编号 = "INT2", 客户名称 = "集成新增" });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        using var verify = new SqlConnection(fx.ConnectionString);
        verify.Open();
        Assert.Equal(1, verify.ExecuteScalar<int>("SELECT COUNT(*) FROM [客户资料] WHERE [客户编号]='INT2'"));
        Assert.True(verify.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]='p1editor' AND [行为]=N'新增'") >= 1);
    }

    private void SeedMaterialPerm(string user, bool canSeePrice)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[单价])
                    VALUES(@user,N'物料资料',1,@canSeePrice)", new { user, canSeePrice });
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='PRICE1'");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单价]) VALUES(N'PRICE1',N'保密料',66)");
    }

    [SkippableFact]
    public async Task Price_field_masked_without_单价_permission()
    {
        using var app = Factory();
        // 无"单价"权限:单价应被后端置空
        SeedMaterialPerm("p1noprice", canSeePrice: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1noprice"));
        var resp = await client.GetFromJsonAsync<JsonElement>("/api/master/materials?keyword=PRICE1&size=50");
        var row = resp.GetProperty("items").EnumerateArray()
            .First(e => e.GetProperty("物料编号").GetString() == "PRICE1");
        Assert.Equal(JsonValueKind.Null, row.GetProperty("单价").ValueKind); // 单价被剥离
    }

    [SkippableFact]
    public async Task Price_field_visible_with_单价_permission()
    {
        using var app = Factory();
        // 有"单价"权限:单价正常返回
        SeedMaterialPerm("p1price", canSeePrice: true);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1price"));
        var resp = await client.GetFromJsonAsync<JsonElement>("/api/master/materials?keyword=PRICE1&size=50");
        var row = resp.GetProperty("items").EnumerateArray()
            .First(e => e.GetProperty("物料编号").GetString() == "PRICE1");
        Assert.Equal(66m, row.GetProperty("单价").GetDecimal()); // 单价可见
    }

    private long SeedPricedMaterial(string 编号, decimal 单价, decimal 销售价, string 名称)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@n", new { n = 编号 });
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单价],[销售价]) VALUES(@n,@nm,@p,@s)",
            new { n = 编号, nm = 名称, p = 单价, s = 销售价 });
        return c.ExecuteScalar<long>("SELECT [ID] FROM [物料资料] WHERE [物料编号]=@n", new { n = 编号 });
    }

    private void SeedMaterialPermFull(string user, bool canSeePrice)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[单价])
                    VALUES(@user,N'物料资料',1,1,@canSeePrice)", new { user, canSeePrice });
    }

    [SkippableFact]
    public async Task Update_preserves_prices_when_user_lacks_单价_permission()
    {
        using var app = Factory();
        var id = SeedPricedMaterial("PRUPD1", 10m, 15m, "原名");
        SeedMaterialPermFull("p1updnoprice", canSeePrice: false);
        try
        {
            var client = app.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1updnoprice"));
            // 无"单价"权限提交:body 不含价格(脱敏为 null)，更新后应保留库中原价、改掉名称
            var resp = await client.PutAsJsonAsync($"/api/master/materials/{id}",
                new { ID = id, 物料编号 = "PRUPD1", 物料名称 = "改名", 单价 = (decimal?)null, 销售价 = (decimal?)null });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            Assert.Equal("改名", c.ExecuteScalar<string>("SELECT [物料名称] FROM [物料资料] WHERE [ID]=@id", new { id }));
            Assert.Equal(10m, c.ExecuteScalar<decimal?>("SELECT [单价] FROM [物料资料] WHERE [ID]=@id", new { id }));
            Assert.Equal(15m, c.ExecuteScalar<decimal?>("SELECT [销售价] FROM [物料资料] WHERE [ID]=@id", new { id }));
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='PRUPD1'");
        }
    }

    [SkippableFact]
    public async Task Update_applies_prices_when_user_has_单价_permission()
    {
        using var app = Factory();
        var id = SeedPricedMaterial("PRUPD2", 10m, 15m, "原名");
        SeedMaterialPermFull("p1updprice", canSeePrice: true);
        try
        {
            var client = app.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1updprice"));
            // 有"单价"权限:提交的新价格生效
            var resp = await client.PutAsJsonAsync($"/api/master/materials/{id}",
                new { ID = id, 物料编号 = "PRUPD2", 物料名称 = "原名", 单价 = 20m, 销售价 = 25m });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            Assert.Equal(20m, c.ExecuteScalar<decimal?>("SELECT [单价] FROM [物料资料] WHERE [ID]=@id", new { id }));
            Assert.Equal(25m, c.ExecuteScalar<decimal?>("SELECT [销售价] FROM [物料资料] WHERE [ID]=@id", new { id }));
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='PRUPD2'");
        }
    }

    // 客户资料保存校验(D1/D2/D3 修复):编号/名称必填、超长前置拦截、重复编号中文提示
    [SkippableFact]
    public async Task Customer_create_requires_code_and_name()
    {
        using var app = Factory();
        SeedPerms("p1valid", canSave: true);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1valid"));

        var empty = await client.PostAsJsonAsync("/api/master/customers", new { 客户编号 = "", 客户名称 = "" });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Contains("客户编号不能为空", await empty.Content.ReadAsStringAsync());

        var noName = await client.PostAsJsonAsync("/api/master/customers", new { 客户编号 = "VAL1", 客户名称 = " " });
        Assert.Equal(HttpStatusCode.BadRequest, noName.StatusCode);
        Assert.Contains("客户名称不能为空", await noName.Content.ReadAsStringAsync());
    }

    [SkippableFact]
    public async Task Customer_create_overlength_returns_400_not_500()
    {
        using var app = Factory();
        SeedPerms("p1valid2", canSave: true);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1valid2"));

        var resp = await client.PostAsJsonAsync("/api/master/customers",
            new { 客户编号 = "VAL2", 客户名称 = new string('长', 200) });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Contains("客户名称最长 50 字", await resp.Content.ReadAsStringAsync());
    }

    [SkippableFact]
    public async Task Customer_create_duplicate_code_returns_chinese_message()
    {
        using var app = Factory();
        SeedPerms("p1valid3", canSave: true);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1valid3"));

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='VAL3'"); }
        try
        {
            var first = await client.PostAsJsonAsync("/api/master/customers", new { 客户编号 = "VAL3", 客户名称 = "甲" });
            Assert.Equal(HttpStatusCode.Created, first.StatusCode);
            var dup = await client.PostAsJsonAsync("/api/master/customers", new { 客户编号 = "VAL3", 客户名称 = "乙" });
            Assert.Equal(HttpStatusCode.BadRequest, dup.StatusCode);
            Assert.Contains("客户编号已存在", await dup.Content.ReadAsStringAsync());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='VAL3'");
        }
    }

    // 删除被引用客户(D5 修复):FK 547 转 409 中文提示,不暴露原始 500
    [SkippableFact]
    public async Task Customer_delete_referenced_returns_409_chinese_message()
    {
        using var app = Factory();
        SeedPerms("p1del", canSave: true);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1del"));

        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [头办单] WHERE [客户编号]='DELREF-T'");
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='DELREF-T'");
            c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES('DELREF-T',N'被引用')");
            c.Execute("INSERT INTO [头办单]([客户编号]) VALUES('DELREF-T')");
        }
        try
        {
            var idResp = await client.GetAsync("/api/master/customers?page=1&size=5&keyword=DELREF-T");
            var doc = await JsonDocument.ParseAsync(await idResp.Content.ReadAsStreamAsync());
            var id = doc.RootElement.GetProperty("items")[0].GetProperty("id").GetInt64();

            var resp = await client.DeleteAsync($"/api/master/customers/{id}");
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            Assert.Contains("该数据已被引用，不可删除", await resp.Content.ReadAsStringAsync());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [头办单] WHERE [客户编号]='DELREF-T'");
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='DELREF-T'");
        }
    }
}
