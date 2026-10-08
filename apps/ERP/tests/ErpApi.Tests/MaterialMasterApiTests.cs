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
public class MaterialMasterApiTests(DbFixture fx)
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

    private void SeedPerms(string user, bool open, bool price)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'物料资料'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[单价]) VALUES(@user,N'物料资料',@open,@price)",
            new { user, open, price });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute(@"INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[单位],[单价],[销售价])
                    VALUES(N'面料API',N'MMA01',N'API面料',N'米',10,15)");
    }
    private static void Clean(SqlConnection c)
        => c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA01'");

    [SkippableFact]
    public async Task Forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("mmnoopen", open: false, price: false);
        var resp = await Client(app, "mmnoopen").GetAsync("/api/material-master/categories");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task List_masks_price_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        try
        {
            SeedPerms("mmnoprice", open: true, price: false);
            var noprice = await Client(app, "mmnoprice")
                .GetFromJsonAsync<JsonElement>("/api/material-master?keyword=MMA01");
            var row = noprice.GetProperty("items")[0];
            Assert.Equal(JsonValueKind.Null, row.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, row.GetProperty("销售价").ValueKind);

            SeedPerms("mmprice", open: true, price: true);
            var withprice = await Client(app, "mmprice")
                .GetFromJsonAsync<JsonElement>("/api/material-master?keyword=MMA01");
            Assert.Equal(10m, withprice.GetProperty("items")[0].GetProperty("单价").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }

    private void SeedPermsSave(string user, bool open, bool save)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'物料资料'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存]) VALUES(@user,N'物料资料',@open,@save)",
            new { user, open, save });
    }

    [SkippableFact]
    public async Task NextCode_forbidden_without_save_permission()
    {
        using var app = Factory();
        SeedPermsSave("mmnosave", open: true, save: false);
        var resp = await Client(app, "mmnosave").GetAsync("/api/material-master/next-code?类别=面料");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Create_generates_code_when_blank()
    {
        using var app = Factory();
        SeedPermsSave("mmcreate", open: true, save: true);
        string? code = null;
        try
        {
            var resp = await Client(app, "mmcreate").PostAsJsonAsync("/api/material-master",
                new { 物料类别 = "API生成类", 物料名称 = "API生成料" });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var created = await resp.Content.ReadFromJsonAsync<JsonElement>();
            code = created.GetProperty("物料编号").GetString();
            Assert.False(string.IsNullOrWhiteSpace(code));
            Assert.StartsWith("API生成类", code);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString);
            c.Open();
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@code", new { code });
        }
    }

    private void SeedPermsSavePrice(string user, bool price)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'物料资料'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[单价]) VALUES(@user,N'物料资料',1,1,@price)",
            new { user, price });
    }

    // Create 路径价格剥离：无"单价"权限者提交的价格字段不落库（与 Update 回填保护同源，泛型 [PriceField] 策略）
    [SkippableFact]
    public async Task Create_strips_price_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'"); }
        try
        {
            SeedPermsSavePrice("mmcreatenoprice", price: false);
            var resp = await Client(app, "mmcreatenoprice").PostAsJsonAsync("/api/master/materials",
                new { 物料类别 = "面料API", 物料编号 = "MMA-STRIP", 物料名称 = "剥离测试料", 单位 = "米", 单价 = 999m, 销售价 = 888m });
            Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

            using var c = new SqlConnection(fx.ConnectionString);
            c.Open();
            var row = c.QuerySingle<(decimal? 单价, decimal? 销售价)>(
                "SELECT [单价],[销售价] FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'");
            Assert.Null(row.单价);
            Assert.Null(row.销售价);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString);
            c.Open();
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'");
        }
    }

    [SkippableFact]
    public async Task Create_keeps_price_with_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'"); }
        try
        {
            SeedPermsSavePrice("mmcreateprice", price: true);
            var resp = await Client(app, "mmcreateprice").PostAsJsonAsync("/api/master/materials",
                new { 物料类别 = "面料API", 物料编号 = "MMA-STRIP", 物料名称 = "剥离测试料", 单位 = "米", 单价 = 999m, 销售价 = 888m });
            Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

            using var c = new SqlConnection(fx.ConnectionString);
            c.Open();
            var row = c.QuerySingle<(decimal? 单价, decimal? 销售价)>(
                "SELECT [单价],[销售价] FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'");
            Assert.Equal(999m, row.单价);
            Assert.Equal(888m, row.销售价);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString);
            c.Open();
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMA-STRIP'");
        }
    }
}
