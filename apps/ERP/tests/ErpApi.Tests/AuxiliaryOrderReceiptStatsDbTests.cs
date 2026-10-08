using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryOrderReceiptStatsDbTests(DbFixture fx)
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
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号] IN (N'AORS-R1',N'AORS-R2')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'AORS-R1',N'AORS-R2')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'AORS-O1',N'AORS-O2')");
        c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'AORS-O1',N'AORS-O2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'AORS-A1',N'AORS-M1')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'AORS-S1'");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'AORS-S1',N'辅料订货供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位],[单价]) VALUES(N'AORS-A1',N'辅料胶纸',N'辅料资料',N'2.5*90Y',N'卷',5)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位],[单价]) VALUES(N'AORS-M1',N'普通布料',N'布料',N'100D',N'米',2)");

        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核])
                    VALUES(N'AORS-O1','2026-07-02','2026-07-15',N'AORS-S1',N'辅料订货供应商',N'辅料仓库',10,50,N'tester','1'),
                          (N'AORS-O2','2026-07-02','2026-07-15',N'AORS-S1',N'辅料订货供应商',N'物料仓',6,12,N'tester','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额])
                    VALUES(N'AORS-O1','2026-07-02','2026-07-15',N'AORS-S1',N'辅料订货供应商',N'辅料仓库',N'辅料资料',N'AORS-A1',N'辅料胶纸',N'2.5*90Y',N'透明',N'卷',10,5,50),
                          (N'AORS-O2','2026-07-02','2026-07-15',N'AORS-S1',N'辅料订货供应商',N'物料仓',N'布料',N'AORS-M1',N'普通布料',N'100D',N'蓝',N'米',6,2,12)");

        c.Execute(@"INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核])
                    VALUES(N'AORS-R1','2026-07-05',N'AORS-S1',N'辅料订货供应商',N'辅料仓库',3,15,N'tester','1'),
                          (N'AORS-R2','2026-07-06',N'AORS-S1',N'辅料订货供应商',N'辅料仓库',10,50,N'tester','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额])
                    VALUES(N'AORS-R1',N'AORS-O1','2026-07-05',N'辅料仓库',N'辅料资料',N'AORS-A1',N'辅料胶纸',N'2.5*90Y',N'透明',N'卷',3,5,15),
                          (N'AORS-R2',N'AORS-O1','2026-07-06',N'辅料仓库',N'辅料资料',N'AORS-A1',N'辅料胶纸',N'2.5*90Y',N'透明',N'卷',10,5,50)");
    }

    [SkippableFact]
    public async Task Auxiliary_order_receipt_stats_calculates_order_receipt_and_difference()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryOrderReceiptStatsAsync(
                new DateTime(2026, 7, 1),
                new DateTime(2026, 7, 31),
                keyword: "胶纸",
                日期类型: "订购日期");

            var row = Assert.Single(rows);
            Assert.Equal(new DateTime(2026, 7, 2), row.订购日期);
            Assert.Equal(new DateTime(2026, 7, 15), row.交货日期);
            Assert.Equal("AORS-O1", row.订购单号);
            Assert.Equal("辅料订货供应商", row.供应商名称);
            Assert.Equal("AORS-A1", row.辅料编号);
            Assert.Equal("辅料胶纸", row.辅料名称);
            Assert.Equal("2.5*90Y", row.规格);
            Assert.Equal("卷", row.单位);
            Assert.Equal(5m, row.采购单价);
            Assert.Equal(10m, row.订货数量);
            Assert.Equal(50m, row.订货金额HKD);
            Assert.Equal(3m, row.入库数量);
            Assert.Equal(15m, row.入库订货金额HKD);
            Assert.Equal(15m, row.入库金额合计HKD);
            Assert.Equal(7m, row.相关数量);
            Assert.Equal(35m, row.相关金额HKD);
            Assert.Equal("tester", row.操作员);
        }
        finally { Cleanup(c); }
    }
}
