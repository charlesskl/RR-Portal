using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryProgressDetailDbTests(DbFixture fx)
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
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号] IN (N'APD-R1',N'APD-R2',N'APD-R3')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'APD-R1',N'APD-R2',N'APD-R3')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'APD-O1',N'APD-O2',N'APD-O3')");
        c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'APD-O1',N'APD-O2',N'APD-O3')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'APD-A1',N'APD-A2',N'APD-M1')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'APD-S1'");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'APD-S1',N'辅料进度供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位],[单价]) VALUES(N'APD-A1',N'辅料胶纸A',N'辅料资料',N'2.5*90Y',N'卷',5)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位],[单价]) VALUES(N'APD-A2',N'辅料胶纸B',N'辅料资料',N'30MM',N'PCS',3)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位],[单价]) VALUES(N'APD-M1',N'普通布料',N'布料',N'100D',N'米',2)");

        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核])
                    VALUES(N'APD-O1','2026-07-02','2026-07-15',N'APD-S1',N'辅料进度供应商',N'辅料仓库',10,50,N'tester','1'),
                          (N'APD-O2','2026-07-03','2026-07-16',N'APD-S1',N'辅料进度供应商',N'辅料仓库',4,12,N'tester','1'),
                          (N'APD-O3','2026-07-04','2026-07-17',N'APD-S1',N'辅料进度供应商',N'物料仓',6,12,N'tester','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额])
                    VALUES(N'APD-O1','2026-07-02','2026-07-15',N'APD-S1',N'辅料进度供应商',N'辅料仓库',N'辅料资料',N'APD-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',10,5,50),
                          (N'APD-O2','2026-07-03','2026-07-16',N'APD-S1',N'辅料进度供应商',N'辅料仓库',N'辅料资料',N'APD-A2',N'辅料胶纸B',N'30MM',N'透明',N'PCS',4,3,12),
                          (N'APD-O3','2026-07-04','2026-07-17',N'APD-S1',N'辅料进度供应商',N'物料仓',N'布料',N'APD-M1',N'普通布料',N'100D',N'蓝',N'米',6,2,12)");

        c.Execute(@"INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核])
                    VALUES(N'APD-R1','2026-07-05',N'APD-S1',N'辅料进度供应商',N'辅料仓库',3,15,N'tester','1'),
                          (N'APD-R2','2026-07-06',N'APD-S1',N'辅料进度供应商',N'辅料仓库',2,10,N'tester','1'),
                          (N'APD-R3','2026-07-07',N'APD-S1',N'辅料进度供应商',N'辅料仓库',10,50,N'tester','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额])
                    VALUES(N'APD-R1',N'APD-O1','2026-07-05',N'辅料仓库',N'辅料资料',N'APD-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',3,5,15),
                          (N'APD-R2',N'APD-O1','2026-07-06',N'辅料仓库',N'辅料资料',N'APD-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',2,5,10),
                          (N'APD-R3',N'APD-O1','2026-07-07',N'辅料仓库',N'辅料资料',N'APD-A1',N'辅料胶纸A',N'2.5*90Y',N'透明',N'卷',10,5,50)");
    }

    [SkippableFact]
    public async Task Auxiliary_progress_detail_expands_receipts_and_calculates_total_and_difference()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryProgressDetailAsync(
                到货情况: "未到",
                起: null,
                止: null,
                keyword: "胶纸",
                日期类型: null);

            Assert.Equal(3, rows.Count);
            Assert.All(rows, r => Assert.Equal("辅料进度供应商", r.供应商名称));
            Assert.DoesNotContain(rows, r => r.辅料编号 == "APD-M1");

            var receivedRows = rows.Where(r => r.订购单号 == "APD-O1").OrderBy(r => r.入仓日期).ToList();
            Assert.Equal(2, receivedRows.Count);
            Assert.Equal("APD-R1", receivedRows[0].入仓单号);
            Assert.Equal(3m, receivedRows[0].入仓数量);
            Assert.Equal(5m, receivedRows[0].总入仓数);
            Assert.Equal(5m, receivedRows[0].相差数量);
            Assert.Equal("人民币", receivedRows[0].单价类型);

            var notReceived = Assert.Single(rows, r => r.订购单号 == "APD-O2");
            Assert.Null(notReceived.入仓单号);
            Assert.Null(notReceived.入仓日期);
            Assert.Equal(0m, notReceived.总入仓数);
            Assert.Equal(4m, notReceived.相差数量);

            var completeRows = await Svc().AuxiliaryProgressDetailAsync("已到", null, null, "胶纸", null);
            Assert.Empty(completeRows);
        }
        finally { Cleanup(c); }
    }
}
