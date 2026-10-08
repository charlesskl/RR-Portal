using Dapper;
using ErpApi.Data;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

// BOM 按 PO 号绑定：审核自动绑（台头 待绑定PO号）/ 显式绑定 / 生产通知单创建自动绑。
[Collection("db")]
public class StylePoBindingDbTests(DbFixture fx)
{
    private const string 款号 = P2TestData.款号;   // P2TK01
    private const string PO = "P2PO001";
    private const string PO2 = "P2PO002";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Svc() => new(Factory(), Ctx());

    private ProductionService ProdSvc() =>
        new(Factory(), new DocumentNumberGenerator(),
            new ErpApi.Engines.Inventory.MaterialInventoryService(Factory()));

    // 清理：绑定表 + BOM 台头（P2TestData.Cleanup 不含这两张）
    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [款号物料PO绑定] WHERE [款号]=@款号", new { 款号 });
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
        P2TestData.Cleanup(c);
    }

    private int BindingCount(string po)
    {
        using var c = fx.Open();
        return c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [款号物料PO绑定] WHERE [款号]=@款号 AND [PO号]=@po",
            new { 款号, po });
    }

    private static BomSaveDto BomDto(string? 待绑定PO号 = null) => new(
        null, null, null, "米",
        [new StyleMaterialDto("P2TM01", "P2面料", null, null, null, "米", 2)],
        待绑定PO号: 待绑定PO号);

    [SkippableFact]
    public async Task Bom_audit_binds_pending_po_and_clears_it()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        var svc = Svc();

        await svc.ReplaceMaterialsAsync(款号, BomDto(PO));
        // 保存后台头落 待绑定PO号
        Assert.Equal(PO, c.ExecuteScalar<string>(
            "SELECT [待绑定PO号] FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 }));

        await svc.BomSetAuditAsync(款号, true, "tester");

        // 审核成功 → 写入绑定 + 清空 待绑定PO号
        Assert.Equal(1, BindingCount(PO));
        Assert.Null(c.ExecuteScalar<string>(
            "SELECT [待绑定PO号] FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 }));
        Cleanup();
    }

    [SkippableFact]
    public async Task Bom_audit_without_pending_po_creates_no_binding()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        var svc = Svc();

        await svc.ReplaceMaterialsAsync(款号, BomDto());
        await svc.BomSetAuditAsync(款号, true, "tester");

        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [款号物料PO绑定] WHERE [款号]=@款号", new { 款号 }));
        Cleanup();
    }

    [SkippableFact]
    public async Task BindPoAsync_is_idempotent_and_rejects_empty_po()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        var svc = Svc();

        await svc.BindPoAsync(款号, PO);
        await svc.BindPoAsync(款号, PO);   // 幂等：绑两次只有一条
        Assert.Equal(1, BindingCount(PO));

        await Assert.ThrowsAsync<ArgumentException>(() => svc.BindPoAsync(款号, "  "));
        await Assert.ThrowsAsync<ArgumentException>(() => svc.BindPoAsync(款号, ""));
        Cleanup();
    }

    [SkippableFact]
    public async Task GetPoBindingsAsync_returns_bound_pos_ordered_by_time()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        var svc = Svc();

        Assert.Empty(await svc.GetPoBindingsAsync(款号));

        await svc.BindPoAsync(款号, PO);
        await svc.BindPoAsync(款号, PO2);
        var list = await svc.GetPoBindingsAsync(款号);
        Assert.Equal(2, list.Count);
        Assert.Equal(PO, list[0].PO号);
        Assert.Equal(PO2, list[1].PO号);
        Assert.True(list[0].绑定时间 <= list[1].绑定时间);
        Cleanup();
    }

    [SkippableFact]
    public async Task Production_create_binds_bom_style_to_contract_no_idempotently()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);

        ProductionNoticeCreateDto Dto() => new()
        {
            合同号 = PO,
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
            货号明细 =
            [
                new ProductionGoodsLineDto
                {
                    货号 = "HH-PO", BOM款号 = 款号, 款号名称 = "P2测试款式", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 10 } ]
                }
            ]
        };

        var 单号1 = await ProdSvc().CreateAsync(Dto(), "tester");
        // 创建成功 → (BOM款号, 合同号) 自动绑定
        Assert.Equal(1, BindingCount(PO));

        var 单号2 = await ProdSvc().CreateAsync(Dto(), "tester");
        // 重复创建同 PO → 不重复绑定
        Assert.Equal(1, BindingCount(PO));
        Assert.NotEqual(单号1, 单号2);

        Cleanup();
    }

    [SkippableFact]
    public async Task Production_create_without_contract_no_creates_no_binding()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);

        var dto = new ProductionNoticeCreateDto
        {
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
            货号明细 =
            [
                new ProductionGoodsLineDto
                {
                    货号 = "HH-PO", BOM款号 = 款号, 款号名称 = "P2测试款式", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 10 } ]
                }
            ]
        };
        await ProdSvc().CreateAsync(dto, "tester");
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [款号物料PO绑定] WHERE [款号]=@款号", new { 款号 }));
        Cleanup();
    }
}
