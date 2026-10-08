using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Production.Replenishment;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReplenishmentServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ReplenishmentService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 测试物料用 RES- 前缀,备注打 RES-UT 标记,避免撞真实数据
    private const string Tag = "RES-UT";
    private const string 来料物料 = "RES-M-001";
    private const string 塑胶物料 = "RES-P-001";

    private static void Cleanup(SqlConnection c)
    {
        c.Execute(@"DELETE FROM [补料明细单] WHERE [单号] IN (SELECT [单号] FROM [补料单] WHERE [备注] LIKE @tag + N'%');", new { tag = Tag });
        c.Execute(@"DELETE FROM [补料单] WHERE [备注] LIKE @tag + N'%';", new { tag = Tag });
    }

    private static ReplenishmentCreateDto 载荷(string 仓库, params (string 物料, decimal 数量)[] lines) => new()
    {
        日期 = DateTime.Today,
        部门 = "装配部",
        生产单号 = "RES-SC-001",
        款号 = "RES-款",
        仓库 = 仓库,
        PMC = "测试PMC",
        备注 = Tag,
        明细 = lines.Select(l => new ReplenishmentLineDto
        {
            物料编号 = l.物料, 物料名称 = "测试物料", 规格 = "S", 颜色 = "红", 单位 = "PCS", 数量 = l.数量,
        }).ToList(),
    };

    [SkippableFact]
    public async Task Create_list_get_roundtrip()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 单号 = await svc.CreateAsync(载荷("来料仓", (来料物料, 5m), ("RES-M-002", 3m)), "tester");
            Assert.StartsWith("BUL", 单号);

            var list = await svc.ListAsync(1, 20, 单号, null);
            var h = Assert.Single(list.Items);
            Assert.Equal(单号, h.单号);
            Assert.Equal("来料仓", h.仓库);
            Assert.Equal("测试PMC", h.PMC);
            Assert.Equal(8m, h.数量);
            Assert.Equal("0", h.审核);

            // 审核过滤
            Assert.Empty((await svc.ListAsync(1, 20, 单号, "已审核")).Items);
            Assert.Single((await svc.ListAsync(1, 20, 单号, "未审核")).Items);

            var d = await svc.GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal("装配部", d!.单头!.部门);
            Assert.Equal("RES-SC-001", d.单头.生产单号);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal(来料物料, d.明细[0].物料编号);
            Assert.Equal(5m, d.明细[0].数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_rejects_bad_warehouse_empty_lines_and_zero_qty()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var ex1 = await Assert.ThrowsAsync<ArgumentException>(
                () => svc.CreateAsync(载荷("半成品仓", (来料物料, 1m)), "tester"));
            Assert.Contains("仓库", ex1.Message);

            var ex2 = await Assert.ThrowsAsync<ArgumentException>(
                () => svc.CreateAsync(载荷("来料仓"), "tester"));
            Assert.Contains("明细", ex2.Message);

            // 物料编号全空白也视为空明细
            var blank = 载荷("来料仓", ("  ", 1m));
            var ex3 = await Assert.ThrowsAsync<ArgumentException>(() => svc.CreateAsync(blank, "tester"));
            Assert.Contains("明细", ex3.Message);

            var ex4 = await Assert.ThrowsAsync<ArgumentException>(
                () => svc.CreateAsync(载荷("塑胶仓", (塑胶物料, 0m)), "tester"));
            Assert.Contains("大于 0", ex4.Message);

            // PMC 必填
            var noPmc = 载荷("来料仓", (来料物料, 1m));
            noPmc.PMC = null;
            var ex5 = await Assert.ThrowsAsync<ArgumentException>(() => svc.CreateAsync(noPmc, "tester"));
            Assert.Contains("PMC", ex5.Message);

            Assert.Empty((await svc.ListAsync(1, 20, Tag, null)).Items);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Audit_does_not_change_incoming_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var inv = new MaterialInventoryService(Factory());
            var baseline = await inv.StockOfAsync(来料物料, null);

            var 单号 = await svc.CreateAsync(载荷("来料仓", (来料物料, 10m)), "tester");

            // 未审核不扣库存
            Assert.Equal(baseline, await inv.StockOfAsync(来料物料, null));

            await svc.AuditAsync(单号, "keeper");
            // 补料只是采购申请：审核也不扣库存（扣库存走 采购入库→领料单）
            Assert.Equal(baseline, await inv.StockOfAsync(来料物料, null));
            var d = await svc.GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            Assert.Equal("keeper", d.单头.审核人);
            Assert.NotNull(d.单头.审核时间);

            // 已审核：不能重复审核、不能删除
            await Assert.ThrowsAsync<InvalidOperationException>(() => svc.AuditAsync(单号, "keeper"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => svc.DeleteAsync(单号));

            // 反审核：库存依旧不变
            await svc.ReverseAuditAsync(单号, "keeper");
            Assert.Equal(baseline, await inv.StockOfAsync(来料物料, null));
            d = await svc.GetAsync(单号);
            Assert.Equal("0", d!.单头!.审核);
            Assert.Null(d.单头.审核人);

            // 未审核可删
            Assert.True(await svc.DeleteAsync(单号));
            Assert.Null(await svc.GetAsync(单号));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Audit_does_not_change_plastic_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var plastic = new PlasticInventoryService(Factory());
            var material = new MaterialInventoryService(Factory());
            var baseline = await plastic.StockOfAsync(塑胶物料, null);
            var baselineM = await material.StockOfAsync(塑胶物料, null);

            var 单号 = await svc.CreateAsync(载荷("塑胶仓", (塑胶物料, 6m)), "tester");
            Assert.Equal(baseline, await plastic.StockOfAsync(塑胶物料, null));   // 未审核不计入

            await svc.AuditAsync(单号, "keeper");
            // 审核也不扣库存：两个口径都不动
            Assert.Equal(baseline, await plastic.StockOfAsync(塑胶物料, null));
            Assert.Equal(baselineM, await material.StockOfAsync(塑胶物料, null));

            await svc.ReverseAuditAsync(单号, "keeper");
            Assert.Equal(baseline, await plastic.StockOfAsync(塑胶物料, null));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task MarkPurchased_requires_audit_and_is_idempotent()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            await Assert.ThrowsAsync<KeyNotFoundException>(() => svc.MarkPurchasedAsync("BUL-不存在"));

            var 单号 = await svc.CreateAsync(载荷("来料仓", (来料物料, 2m)), "tester");
            // 未审核不可标
            await Assert.ThrowsAsync<InvalidOperationException>(() => svc.MarkPurchasedAsync(单号));

            await svc.AuditAsync(单号, "keeper");
            await svc.MarkPurchasedAsync(单号);
            var d = await svc.GetAsync(单号);
            Assert.Equal("1", d!.单头!.已采购);
            Assert.NotNull(d.单头.采购时间);

            // 幂等：重复标记不报错
            await svc.MarkPurchasedAsync(单号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_pending_purchase_filters_by_audit_marked_and_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 未审 = await svc.CreateAsync(载荷("来料仓", (来料物料, 1m)), "tester");
            var 待采 = await svc.CreateAsync(载荷("塑胶仓", (塑胶物料, 1m)), "tester");
            var 已采 = await svc.CreateAsync(载荷("来料仓", ("RES-M-002", 1m)), "tester");
            await svc.AuditAsync(待采, "keeper");
            await svc.AuditAsync(已采, "keeper");
            await svc.MarkPurchasedAsync(已采);

            // 待采购=已审核且未标已采购：只剩 待采 一张
            var pend = await svc.ListAsync(1, 20, Tag, null, null, 待采购: true);
            var h = Assert.Single(pend.Items);
            Assert.Equal(待采, h.单号);
            Assert.Equal("0", h.已采购);

            // 仓库过滤叠加：塑胶仓命中，来料仓空
            Assert.Single((await svc.ListAsync(1, 20, Tag, null, "塑胶仓", true)).Items);
            Assert.Empty((await svc.ListAsync(1, 20, Tag, null, "来料仓", true)).Items);

            // 不带待采购时仓库过滤照常工作（Tag 下 来料仓=未审+已采 两张）
            Assert.Equal(2, (await svc.ListAsync(1, 20, Tag, null, "来料仓")).Total);
            _ = 未审;
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Audit_and_reverse_on_missing_doc_throw_notfound()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var svc = Svc();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => svc.AuditAsync("BUL-不存在", "keeper"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => svc.ReverseAuditAsync("BUL-不存在", "keeper"));
        Assert.False(await svc.DeleteAsync("BUL-不存在"));
    }
}
