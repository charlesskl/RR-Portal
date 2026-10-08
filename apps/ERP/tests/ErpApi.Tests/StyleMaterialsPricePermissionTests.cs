using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

public sealed class StyleMaterialsPricePolicyTests
{
    [Fact]
    public void Redact_clears_all_protected_prices()
    {
        var dto = View(
            Extension(12.5m, 3.5m),
            [Quote(7, 10m, 11m, 1m, 0.1m)]);

        var redacted = StyleMaterialsPricePolicy.Redact(dto);

        Assert.Null(redacted.扩展.库存单价HK);
        Assert.Null(redacted.扩展.其他成本HK);
        var quote = Assert.Single(redacted.报价);
        Assert.Null(quote.单价);
        Assert.Null(quote.港币价);
        Assert.Null(quote.对比相差);
        Assert.Null(quote.相差比例);
        Assert.Equal(7, quote.ID);
        Assert.Equal("加工厂甲", quote.合作方名称);
    }

    [Fact]
    public void PreserveProtectedPrices_restores_existing_values_and_nulls_new_quote_prices()
    {
        var existing = Quote(7, 10m, 11m, 1m, 0.1m);
        var incoming = new BomSaveDto(null, null, null, null, [],
            Extension(999m, 998m) with { 共用物料编号 = "COMMON-EDIT" },
            [
                existing with { ID = null, 合作方名称 = "加工厂改名", 单价 = 999m, 港币价 = 999m, 对比相差 = 999m, 相差比例 = 999m },
                Quote(null, 888m, 888m, 888m, 888m) with { 合作方编号 = "NEW", 顺序 = 2 }
            ]);

        var protectedDto = StyleMaterialsPricePolicy.PreserveProtectedPrices(
            incoming, Extension(12.5m, 3.5m), [existing]);

        Assert.Equal("COMMON-EDIT", protectedDto.扩展!.共用物料编号);
        Assert.Equal(12.5m, protectedDto.扩展.库存单价HK);
        Assert.Equal(3.5m, protectedDto.扩展.其他成本HK);
        Assert.Equal("加工厂改名", protectedDto.报价![0].合作方名称);
        Assert.Equal(10m, protectedDto.报价[0].单价);
        Assert.Equal(11m, protectedDto.报价[0].港币价);
        Assert.Equal(1m, protectedDto.报价[0].对比相差);
        Assert.Equal(0.1m, protectedDto.报价[0].相差比例);
        Assert.Null(protectedDto.报价[1].单价);
        Assert.Null(protectedDto.报价[1].港币价);
        Assert.Null(protectedDto.报价[1].对比相差);
        Assert.Null(protectedDto.报价[1].相差比例);
    }

    [Fact]
    public void PreserveProtectedPrices_keeps_omitted_and_explicit_empty_sections_distinct()
    {
        var omitted = new BomSaveDto(null, null, null, null, []);
        var emptyQuotes = omitted with { 报价 = [] };

        Assert.Null(StyleMaterialsPricePolicy.PreserveProtectedPrices(
            omitted, Extension(1m, 2m), [Quote(1, 1m, 1m, 0m, 0m)]).报价);
        Assert.Empty(StyleMaterialsPricePolicy.PreserveProtectedPrices(
            emptyQuotes, Extension(1m, 2m), [Quote(1, 1m, 1m, 0m, 0m)]).报价!);
    }

    [Fact]
    public void Redact_preserves_absent_optional_sections()
    {
        var redacted = StyleMaterialsPricePolicy.Redact(
            new StyleMaterialsViewDto("STYLE-OLD", "产品", [], null, null));

        Assert.Null(redacted.扩展);
        Assert.Null(redacted.报价);
    }

    private static StyleMaterialsViewDto View(
        AssemblyMaterialExtensionDto extension, IReadOnlyList<AssemblyMaterialQuoteDto> quotes)
        => new("STYLE-PRICE", "产品", [], extension, quotes);

    internal static AssemblyMaterialExtensionDto Extension(decimal? stock, decimal? other) => new(
        "产品装配", "PART-1", "COMMON-1", "组装", "半成品", stock, other,
        1m, "PCS", true, "备注", false, null, null);

    internal static AssemblyMaterialQuoteDto Quote(
        long? id, decimal? price, decimal? hkd, decimal? difference, decimal? ratio) => new(
        id, "MAT-1", "彩盒", "加工厂", "0088", "加工厂甲", new DateTime(2026, 7, 14),
        "HK$", price, hkd, difference, ratio, true, 1, "报价备注");
}

[Collection("db")]
public sealed class StyleMaterialsPricePermissionApiTests(DbFixture fx)
{
    private const string StyleNo = "STYLE-PRICE";
    private const string User = "style-price-no";

    [SkippableFact]
    public async Task No_price_permission_redacts_reads_and_preserves_prices_on_write()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyleAndPermission();
        await Style().ReplaceMaterialsAsync(StyleNo, Payload());

        try
        {
            using var app = ApiFactory();
            using var client = Client(app);
            var before = await Style().GetMaterialsViewAsync(StyleNo);

            var read = await client.GetFromJsonAsync<JsonElement>($"/api/styles/{StyleNo}/materials");
            Assert.Equal(JsonValueKind.Null, read.GetProperty("扩展").GetProperty("库存单价HK").ValueKind);
            Assert.Equal(JsonValueKind.Null, read.GetProperty("扩展").GetProperty("其他成本HK").ValueKind);
            var redactedQuote = read.GetProperty("报价")[0];
            Assert.Equal(JsonValueKind.Null, redactedQuote.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, redactedQuote.GetProperty("港币价").ValueKind);
            Assert.Equal(JsonValueKind.Null, redactedQuote.GetProperty("对比相差").ValueKind);
            Assert.Equal(JsonValueKind.Null, redactedQuote.GetProperty("相差比例").ValueKind);

            var malicious = Payload() with
            {
                扩展 = Payload().扩展! with { 共用物料编号 = "COMMON-EDIT", 库存单价HK = 999m, 其他成本HK = 998m },
                报价 = [Payload().报价![0] with
                {
                    ID = before!.报价[0].ID,
                    合作方名称 = "加工厂改名",
                    单价 = 999m,
                    港币价 = 999m,
                    对比相差 = 999m,
                    相差比例 = 999m
                }]
            };
            var response = await client.PutAsJsonAsync($"/api/styles/{StyleNo}/materials", malicious);
            response.EnsureSuccessStatusCode();

            var saved = await Style().GetMaterialsViewAsync(StyleNo);
            Assert.Equal("COMMON-EDIT", saved!.扩展.共用物料编号);
            Assert.Equal(12.5m, saved.扩展.库存单价HK);
            Assert.Equal(3.5m, saved.扩展.其他成本HK);
            Assert.Equal("加工厂改名", saved.报价[0].合作方名称);
            Assert.Equal(10m, saved.报价[0].单价);
            Assert.Equal(11m, saved.报价[0].港币价);
            Assert.Equal(1m, saved.报价[0].对比相差);
            Assert.Equal(0.1m, saved.报价[0].相差比例);
        }
        finally
        {
            Cleanup();
        }
    }

    private ISqlConnectionFactory SqlFactory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Style() => new(SqlFactory(), Ctx());

    private WebApplicationFactory<Program> ApiFactory()
    {
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Erp:Jwt:Issuer"] = "ErpApi",
            ["Erp:Jwt:Audience"] = "ErpClient",
            ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private static HttpClient Client(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", new JwtTokenService(JwtCfg()).Issue(User));
        return client;
    }

    private void SkipIfDatabaseUnavailable()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        try
        {
            using var c = fx.Open();
        }
        catch (SqlException ex)
        {
            Skip.If(true, $"ERP_TEST_DB 不可连接：{ex.Message}");
        }
    }

    private void SeedStyleAndPermission()
    {
        using var c = fx.Open();
        // 客户编号 FK→客户资料(FK_129)、明细物料编号 FK→物料资料(FK_133)，需先建父行
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'0003',N'ZURU')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'MAT-1',N'彩盒',N'PCS')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(@StyleNo,N'产品')", new { StyleNo });
        c.Execute(@"INSERT INTO [款号物料总表]([日期],[客户编号],[客户名称],[产品编号],[款号],[款式],[备注],[单位])
VALUES('2026-07-14',N'0003',N'ZURU',N'PART-1',@StyleNo,N'产品',N'头备注',N'PCS')", new { StyleNo });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[单价])
VALUES(@User,N'款号资料',1,1,0)", new { User });
    }

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [装配物料报价] WHERE [产品货号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'0003'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MAT-1'");
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@User AND [菜单]=N'款号资料'", new { User });
    }

    private static BomSaveDto Payload() => new(
        "0003", "ZURU", new DateTime(2026, 7, 14), "PCS",
        [new StyleMaterialDto("MAT-1", "彩盒", "包装", null, null, "PCS", 1m)],
        StyleMaterialsPricePolicyTests.Extension(12.5m, 3.5m),
        [StyleMaterialsPricePolicyTests.Quote(null, 10m, 11m, 1m, 0.1m)]);
}
