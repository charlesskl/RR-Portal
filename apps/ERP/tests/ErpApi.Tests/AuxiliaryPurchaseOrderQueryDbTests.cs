using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryPurchaseOrderQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'APOQ-O1',N'APOQ-O2',N'APOQ-O3')");
        c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'APOQ-O1',N'APOQ-O2',N'APOQ-O3')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'APOQ-A1',N'APOQ-A2',N'APOQ-M1')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号] IN (N'APOQ-S1',N'APOQ-S2')");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'APOQ-S1',N'辅料采购供应商一'),(N'APOQ-S2',N'辅料采购供应商二')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'APOQ-A1',N'辅料胶纸A',N'辅料资料',N'2.5*90Y',N'卷')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'APOQ-A2',N'辅料胶纸B',N'辅料资料',N'30MM',N'PCS')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'APOQ-M1',N'普通布料',N'布料',N'100D',N'米')");

        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核])
                    VALUES(N'APOQ-O1','2026-07-02','2026-07-15',N'APOQ-S1',N'辅料采购供应商一',N'辅料仓库',15,75,N'tester','1'),
                          (N'APOQ-O2','2026-07-03','2026-07-16',N'APOQ-S2',N'辅料采购供应商二',N'辅料仓库',4,12,N'tester','0'),
                          (N'APOQ-O3','2026-07-04','2026-07-17',N'APOQ-S1',N'辅料采购供应商一',N'物料仓',6,12,N'tester','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
                    VALUES(N'APOQ-O1','2026-07-02','2026-07-15',N'APOQ-S1',N'辅料采购供应商一',N'辅料仓库',N'辅料资料',N'APOQ-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',10,5,50,N'已审备注'),
                          (N'APOQ-O1','2026-07-02','2026-07-15',N'APOQ-S1',N'辅料采购供应商一',N'辅料仓库',N'辅料资料',N'APOQ-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',5,5,25,N'已审备注2'),
                          (N'APOQ-O2','2026-07-03','2026-07-16',N'APOQ-S2',N'辅料采购供应商二',N'辅料仓库',N'辅料资料',N'APOQ-A2',N'辅料胶纸B',N'30MM',N'透明',N'PCS',4,3,12,N'未审备注'),
                          (N'APOQ-O3','2026-07-04','2026-07-17',N'APOQ-S1',N'辅料采购供应商一',N'物料仓',N'布料',N'APOQ-M1',N'普通布料',N'100D',N'蓝',N'米',6,2,12,N'不应出现')");
    }

    [SkippableFact]
    public async Task Auxiliary_purchase_order_summary_filters_auxiliary_and_can_group_by_supplier()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryPurchaseOrderQuerySummaryAsync(
                起: new DateTime(2026, 7, 1),
                止: new DateTime(2026, 7, 31),
                keyword: "胶纸",
                物料类别: null,
                日期类型: "订货日期",
                按供应商: false);

            Assert.Equal(2, rows.Count);
            var a = rows.Single(r => r.辅料编号 == "APOQ-A1");
            Assert.Null(a.供应商编号);
            Assert.Equal("辅料胶纸A", a.辅料名称);
            Assert.Equal("2.5*90Y", a.规格);
            Assert.Equal("卷", a.单位);
            Assert.Equal(15m, a.订货数量);
            Assert.DoesNotContain(rows, r => r.辅料编号 == "APOQ-M1");

            var bySupplier = await Svc().AuxiliaryPurchaseOrderQuerySummaryAsync(
                new DateTime(2026, 7, 1), new DateTime(2026, 7, 31),
                "APOQ-S1", null, "订货日期", 按供应商: true);
            var supplierRow = Assert.Single(bySupplier);
            Assert.Equal("APOQ-S1", supplierRow.供应商编号);
            Assert.Equal("辅料采购供应商一", supplierRow.供应商名称);
            Assert.Equal(15m, supplierRow.订货数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Auxiliary_purchase_order_detail_filters_audit_and_delivery_date()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var audited = await Svc().AuxiliaryPurchaseOrderQueryDetailAsync(
                起: new DateTime(2026, 7, 15),
                止: new DateTime(2026, 7, 15),
                keyword: "胶纸A",
                物料类别: null,
                日期类型: "交货日期",
                审核情况: "已审核");
            Assert.Equal(2, audited.Count);
            Assert.All(audited, r =>
            {
                Assert.Equal("APOQ-O1", r.单号);
                Assert.Equal("APOQ-S1", r.供应商编号);
                Assert.Equal("1", r.审核);
            });

            var notAudited = await Svc().AuxiliaryPurchaseOrderQueryDetailAsync(
                起: null,
                止: null,
                keyword: "胶纸B",
                物料类别: null,
                日期类型: "订货日期",
                审核情况: "未审核");
            var row = Assert.Single(notAudited);
            Assert.Equal("APOQ-O2", row.单号);
            Assert.Equal("APOQ-S2", row.供应商编号);
            Assert.Equal("未审备注", row.备注);
            Assert.Equal("0", row.审核);
        }
        finally { Cleanup(c); }
    }
}
