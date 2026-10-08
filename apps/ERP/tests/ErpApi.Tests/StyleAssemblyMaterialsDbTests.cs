using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Features.Warehouse.Semi.CommonMaterials;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class StyleAssemblyMaterialsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Style() => new(Factory(), Ctx());
    private SemiFinishedCommonMaterialService Common() => new(Factory());

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

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [装配物料报价] WHERE [产品货号]=N'STYLE-1'");
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'STYLE-1'");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'STYLE-1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'STYLE-1'");
        // 客户编号 FK→客户资料(FK_129/FK_131)、物料编号 FK→物料资料(FK_133)，引用行删净后再删父
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'0003'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'MAT-1',N'MAT-2',N'MAT-P1',N'MAT-P2')");
    }

    // db/43 新增了 款号总表.[出厂价]/[装彩盒单价]；未部署时跳过自动计算相关测试。
    private void SkipIfAssemblyRuleSchemaMissing()
    {
        using var c = fx.Open();
        var hasColumns = c.ExecuteScalar<int>(
            "SELECT CASE WHEN COL_LENGTH(N'[款号总表]',N'出厂价') IS NOT NULL AND COL_LENGTH(N'[款号总表]',N'装彩盒单价') IS NOT NULL THEN 1 ELSE 0 END") == 1;
        Skip.IfNot(hasColumns, "ERP_TEST_DB 未应用 db/43_assembly_rules.sql");
    }

    private void SeedStyle()
    {
        using var c = fx.Open();
        // 客户编号 FK→客户资料(FK_129)、明细物料编号 FK→物料资料(FK_133)，需先建父行
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'0003',N'ZURU')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'MAT-1',N'彩盒',N'PCS'),(N'MAT-2',N'新物料',N'PCS')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'STYLE-1',N'产品一')");
        c.Execute(@"
INSERT INTO [款号物料总表]([日期],[客户编号],[客户名称],[产品编号],[款号],[款式],[备注],[单位])
VALUES('2026-07-13',N'0003',N'ZURU',N'PART-1',N'STYLE-1',N'产品一',N'头备注',N'盒')");
    }

    [SkippableFact]
    public async Task Legacy_style_without_optional_sections_returns_absent_sections()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");

        Assert.NotNull(loaded);
        Assert.Null(loaded!.扩展);
        Assert.Null(loaded.报价);

        Cleanup();
    }

    [SkippableFact]
    public async Task ReplaceMaterials_round_trips_extension_quotes_and_row_fields()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        await Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload());

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.NotNull(loaded);
        Assert.Equal("COMMON-1", loaded!.扩展.共用物料编号);
        Assert.Equal("加工厂", Assert.Single(loaded.报价).合作方类型);
        Assert.Equal("MOULD-1", loaded.物料.Single().工模编号);
        Assert.Equal("主盒彩盒", loaded.物料.Single().备注);

        Cleanup();
    }

    [SkippableFact]
    public async Task ReplaceMaterials_rolls_back_all_sections_when_quote_is_invalid()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();
        await Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload());

        using var before = fx.Open();
        var originalBomCount = await before.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=N'STYLE-1'");
        var originalCommonCode = await before.ExecuteScalarAsync<string?>(
            "SELECT [共用物料编号] FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'");

        var invalidPayload = ValidPayload() with
        {
            报价 = [new AssemblyMaterialQuoteDto(
                null, "MAT-1", "彩盒", "其他", "X", "非法合作方",
                new DateTime(2026, 7, 13), "HK$", 1, 1, 0, 0, false, 1, null)]
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Style().ReplaceMaterialsAsync("STYLE-1", invalidPayload));

        using var after = fx.Open();
        Assert.Equal(originalBomCount, await after.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=N'STYLE-1'"));
        Assert.Equal(originalCommonCode, await after.ExecuteScalarAsync<string?>(
            "SELECT [共用物料编号] FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'"));

        Cleanup();
    }

    [SkippableFact]
    public async Task Omitted_extension_and_quotes_preserve_existing_values_but_empty_quotes_clear()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();
        await Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload());

        await Style().ReplaceMaterialsAsync("STYLE-1", new BomSaveDto(
            null, null, null, null,
            [new StyleMaterialDto("MAT-2", "新物料", "包装", null, null, null, 2)]));
        var preserved = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.Equal("COMMON-1", preserved!.扩展.共用物料编号);
        Assert.Single(preserved.报价);

        await Style().ReplaceMaterialsAsync("STYLE-1", new BomSaveDto(
            null, null, null, null, [], null, []));
        var cleared = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.Null(cleared!.报价);
        Assert.Equal("COMMON-1", cleared.扩展.共用物料编号);

        Cleanup();
    }

    [SkippableFact]
    public async Task Audited_style_rejects_save_until_reverse_audit_and_preserves_audit_fields_on_save()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();
        await Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload());

        await Common().SetAuditAsync("STYLE-1", true, "auditor");
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload()));

        using (var c = fx.Open())
        {
            var audit = await c.QuerySingleAsync<(bool 调整审核, string 审核人)>(
                "SELECT [调整审核],[审核人] FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'");
            Assert.True(audit.调整审核);
            Assert.Equal("auditor", audit.审核人);
        }

        await Common().SetAuditAsync("STYLE-1", false, "auditor");
        await Style().ReplaceMaterialsAsync("STYLE-1", ValidPayload());
        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.False(loaded!.扩展.调整审核);

        Cleanup();
    }

    [SkippableFact]
    public async Task Audit_creates_extension_for_existing_bom_without_extension()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        await Style().ReplaceMaterialsAsync("STYLE-1", new BomSaveDto(
            "0003", "ZURU", new DateTime(2026, 7, 13), "盒",
            [new StyleMaterialDto("MAT-1", "彩盒", "包装", null, null, "PCS", 1)]));
        await Common().SetAuditAsync("STYLE-1", true, "auditor");

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.True(loaded!.扩展.调整审核);
        Assert.Equal("auditor", loaded.扩展.审核人);

        Cleanup();
    }

    [SkippableFact]
    public async Task In_house_quote_row_without_partner_saves()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        var payload = ValidPayload() with
        {
            报价 = [new AssemblyMaterialQuoteDto(
                null, "MAT-1", "彩盒", "本厂", null, null,
                new DateTime(2026, 7, 13), "HK$", 2.5m, 2.5m, 0, 0, true, 1, "本厂装配")]
        };
        await Style().ReplaceMaterialsAsync("STYLE-1", payload);

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        var quote = Assert.Single(loaded!.报价!);
        Assert.Equal("本厂", quote.合作方类型);
        Assert.Null(quote.合作方编号);
        Assert.Null(quote.合作方名称);

        Cleanup();
    }

    [SkippableFact]
    public async Task In_house_quote_row_with_partner_is_rejected()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        var payload = ValidPayload() with
        {
            报价 = [new AssemblyMaterialQuoteDto(
                null, "MAT-1", "彩盒", "本厂", "0088", "东莞加工厂",
                new DateTime(2026, 7, 13), "HK$", 2.5m, 2.5m, 0, 0, true, 1, null)]
        };
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Style().ReplaceMaterialsAsync("STYLE-1", payload));
        Assert.Contains("本厂", ex.Message);

        Cleanup();
    }

    [SkippableFact]
    public async Task Second_in_house_quote_row_is_rejected()
    {
        SkipIfDatabaseUnavailable();
        Cleanup();
        SeedStyle();

        AssemblyMaterialQuoteDto InHouse(int seq) => new(
            null, "MAT-1", "彩盒", "本厂", null, null,
            new DateTime(2026, 7, 13), "HK$", 2.5m, 2.5m, 0, 0, seq == 1, seq, null);
        var payload = ValidPayload() with { 报价 = [InHouse(1), InHouse(2)] };
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Style().ReplaceMaterialsAsync("STYLE-1", payload));
        Assert.Contains("本厂", ex.Message);

        Cleanup();
    }

    [SkippableFact]
    public async Task Empty_inventory_price_prefers_master_ex_factory_price_for_finished_category()
    {
        SkipIfDatabaseUnavailable();
        SkipIfAssemblyRuleSchemaMissing();
        Cleanup();
        SeedStyle();
        using (var c = fx.Open())
            c.Execute("UPDATE [款号总表] SET [出厂价]=7.5, [装彩盒单价]=3.5 WHERE [款号]=N'STYLE-1'");

        var payload = ValidPayload() with
        {
            扩展 = ValidPayload().扩展! with { 类别 = "成品", 库存单价HK = null }
        };
        await Style().ReplaceMaterialsAsync("STYLE-1", payload);

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.Equal(7.5m, loaded!.扩展!.库存单价HK);

        Cleanup();
    }

    [SkippableFact]
    public async Task Empty_inventory_price_falls_back_to_bom_quantity_times_material_price()
    {
        SkipIfDatabaseUnavailable();
        SkipIfAssemblyRuleSchemaMissing();
        Cleanup();
        SeedStyle();
        using (var c = fx.Open())
            c.Execute(@"
INSERT INTO [物料资料]([物料编号],[物料名称],[单价]) VALUES
    (N'MAT-P1',N'彩盒',2),(N'MAT-P2',N'胶袋',3)");

        var payload = ValidPayload() with
        {
            明细 =
            [
                new StyleMaterialDto("MAT-P1", "彩盒", "包装", null, null, "PCS", 2),
                new StyleMaterialDto("MAT-P2", "胶袋", "包装", null, null, "PCS", 1),
            ],
            扩展 = ValidPayload().扩展! with { 类别 = "半成品", 库存单价HK = null }
        };
        await Style().ReplaceMaterialsAsync("STYLE-1", payload);

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.Equal(7m, loaded!.扩展!.库存单价HK);

        Cleanup();
    }

    [SkippableFact]
    public async Task Manual_inventory_price_is_not_overwritten()
    {
        SkipIfDatabaseUnavailable();
        SkipIfAssemblyRuleSchemaMissing();
        Cleanup();
        SeedStyle();
        using (var c = fx.Open())
            c.Execute("UPDATE [款号总表] SET [出厂价]=7.5 WHERE [款号]=N'STYLE-1'");

        var payload = ValidPayload() with
        {
            扩展 = ValidPayload().扩展! with { 类别 = "成品", 库存单价HK = 9.9m }
        };
        await Style().ReplaceMaterialsAsync("STYLE-1", payload);

        var loaded = await Style().GetMaterialsViewAsync("STYLE-1");
        Assert.Equal(9.9m, loaded!.扩展!.库存单价HK);

        Cleanup();
    }

    private static BomSaveDto ValidPayload() => new(
        "0003", "ZURU", new DateTime(2026, 7, 13), "盒",
        [new StyleMaterialDto(
            "MAT-1", "彩盒", "包装", "41*30MM", "4C", "PCS", 1,
            "MOULD-1", "主盒彩盒")],
        new AssemblyMaterialExtensionDto(
            "产品一装配", "PART-1", "COMMON-1", "组装半成品", "装彩盒半成品",
            2.5m, 0.3m, 1, "盒", true, "测试备注", false, null, null),
        [new AssemblyMaterialQuoteDto(
            null, "MAT-1", "彩盒", "加工厂", "0088", "东莞加工厂",
            new DateTime(2026, 7, 13), "HK$", 2.5m, 2.5m, 0, 0, true, 1, null)]);
}
