using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Assembly;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 装配采购查询快照化统计（2026-07-28 技术债清理）：
// 已落库装配加工采购单的 (生产单号+款号) 组合按 装配加工采购单明细 快照统计；
// 实时展开（款号物料总表×款号物料明细表）用 NOT EXISTS 排除已落库组合，同一组合只计一次。
[Collection("db")]
public class AssemblyPurchaseQuerySnapshotDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private AssemblyPurchaseQueryService Query() => new(Factory());
    private AssemblyPurchaseOrderService Order() => new(Factory(), new DocumentNumberGenerator());

    private static readonly DateTime 起 = new(2026, 7, 1);
    private static readonly DateTime 止 = new(2026, 7, 31);

    // K-QS：落库组合（MO-QS1）；K-QS2：未落库，维持实时展开
    private static void Seed(SqlConnection c)
    {
        Clean(c);
        // 款号物料明细表.物料编号 有 FK 指向 物料资料,主档需先落
        c.Execute("INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[规格],[颜色],[单位]) VALUES(N'辅料资料',N'MAT-QS1',N'快照料',N'SPEC-QS',N'红',N'个')");
        c.Execute("INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[单位]) VALUES(N'辅料资料',N'MAT-QS2',N'实时料',N'个')");
        c.Execute("INSERT INTO [款号物料总表]([款号],[款式],[日期],[使用数量],[审核]) VALUES(N'K-QS',N'快照统计款','2026-07-20',100,N'0')");
        c.Execute("INSERT INTO [款号物料总表]([款号],[款式],[日期],[使用数量],[审核]) VALUES(N'K-QS2',N'实时展开款','2026-07-20',100,N'0')");
        c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[使用数量],[顺序]) VALUES(N'K-QS',N'MAT-QS1',N'快照料',N'辅料资料',N'SPEC-QS',N'红',N'个',2,1)");
        c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[物料类别],[单位],[使用数量],[顺序]) VALUES(N'K-QS2',N'MAT-QS2',N'实时料',N'辅料资料',N'个',1,1)");
        c.Execute("INSERT INTO [生产通知单MO单]([生产单号],[接单日期],[产品货号],[产品名称],[接单数量]) VALUES(N'MO-QS1','2026-07-20',N'K-QS',N'快照统计款',100)");
        c.Execute("INSERT INTO [生产通知单MO单]([生产单号],[接单日期],[产品货号],[产品名称],[接单数量]) VALUES(N'MO-QS2','2026-07-20',N'K-QS2',N'实时展开款',80)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE d FROM [装配加工采购单明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'QS测试客户'");
        c.Execute("DELETE d FROM [装配加工采购单生产明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'QS测试客户'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [客户名称]=N'QS测试客户'");
        c.Execute("DELETE FROM [生产通知单MO单] WHERE [生产单号] IN (N'MO-QS1',N'MO-QS2')");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号] IN (N'K-QS',N'K-QS2')");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] IN (N'K-QS',N'K-QS2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'MAT-QS1',N'MAT-QS2')");
    }

    // 快照口径：保存时前端可改过的需求数量（50×3=150），而非实时 BOM（100×2=200）
    private async Task<string> CreateSnapshotOrderAsync()
        => await Order().CreateAsync(new AssemblyPurchaseOrderSaveDto
        {
            出单日期 = new DateTime(2026, 7, 21),
            供应商编号 = "G-QS",
            供应商名称 = "QS测试加工厂",
            客户名称 = "QS测试客户",
            收货仓库 = "半成品仓",
            生产明细 =
            {
                new() { 接单日期 = "2026-07-20", 生产单号 = "MO-QS1", 款号 = "K-QS", 产品名称 = "快照统计款", 加工数量 = 50, 单价 = 1m }
            },
            物料明细 =
            {
                new() { 生产单号 = "MO-QS1", 款号 = "K-QS", 物料编号 = "MAT-QS1", 物料名称 = "快照料", 单位 = "个", 用量 = 3m, 需求数量 = 150m }
            },
        }, "tester");

    [SkippableFact]
    public async Task Tracking_uses_snapshot_for_saved_order_and_keeps_realtime_rest()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // 落库前：K-QS 实时展开 100×2=200
            var before = (await Query().TrackingAsync(起, 止, null, null, false))
                .Where(r => r.产品货号 is "K-QS" or "K-QS2").ToList();
            Assert.Equal(200m, before.Single(r => r.产品货号 == "K-QS").需求数量);

            var 单号 = await CreateSnapshotOrderAsync();

            var after = (await Query().TrackingAsync(起, 止, null, null, false))
                .Where(r => r.产品货号 is "K-QS" or "K-QS2").ToList();
            // 已落库组合：只按快照计一次（150），不再出现实时展开的 200
            var snap = after.Single(r => r.产品货号 == "K-QS");
            Assert.Equal(单号, snap.订单单号);
            Assert.Equal(150m, snap.需求数量);
            Assert.Equal(3m, snap.单件用量);
            Assert.Equal(50m, snap.加工数量);
            Assert.Equal(150m, snap.未入仓数量);
            Assert.Equal("SPEC-QS", snap.规格);   // 规格/颜色/材料取物料主档
            Assert.Equal("QS测试加工厂", snap.加工厂名称);
            // 未落库款号：维持实时展开（80×1）
            Assert.Equal(80m, after.Single(r => r.产品货号 == "K-QS2").需求数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task RequiredMaterials_and_FactoryInventory_use_snapshot_quantity()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var 单号 = await CreateSnapshotOrderAsync();

            var required = (await Query().RequiredMaterialsAsync(起, 止, null, null, null, null))
                .Where(r => r.产品货号 is "K-QS" or "K-QS2").ToList();
            var snapReq = required.Single(r => r.产品货号 == "K-QS");
            Assert.Equal(单号, snapReq.单号);
            Assert.Equal(150m, snapReq.需领数量);
            Assert.Equal(80m, required.Single(r => r.产品货号 == "K-QS2").需领数量);

            var inv = (await Query().FactoryInventoryAsync(null, null, false, new DateTime(2026, 7, 31), null, null, null, null))
                .Where(r => r.产品货号 is "K-QS" or "K-QS2").ToList();
            Assert.Equal(150m, inv.Single(r => r.产品货号 == "K-QS" && r.物料编号 == "MAT-QS1").领料数量);
            Assert.Equal(80m, inv.Single(r => r.产品货号 == "K-QS2" && r.物料编号 == "MAT-QS2").领料数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task AuxiliaryIssueProgress_uses_snapshot_and_category_from_material_master()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            await CreateSnapshotOrderAsync();

            var rows = (await Query().AuxiliaryIssueProgressAsync(null, null, null, null, null, null, "辅料资料"))
                .Where(r => r.辅料编号 is "MAT-QS1" or "MAT-QS2").ToList();
            // 快照行按 物料资料.物料类别 命中类别过滤，需求数量取快照 150；实时行 80
            Assert.Equal(150m, rows.Single(r => r.辅料编号 == "MAT-QS1" && r.装配生产单号 == "MO-QS1").需求数量);
            Assert.Equal(80m, rows.Single(r => r.辅料编号 == "MAT-QS2").需求数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_order_restores_realtime_expansion()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var 单号 = await CreateSnapshotOrderAsync();
            Assert.True(await Order().DeleteAsync(单号));

            var rows = (await Query().TrackingAsync(起, 止, null, null, false))
                .Where(r => r.产品货号 == "K-QS").ToList();
            Assert.Equal(200m, rows.Single().需求数量);   // 回到实时展开 100×2
        }
        finally { Clean(c); }
    }
}
