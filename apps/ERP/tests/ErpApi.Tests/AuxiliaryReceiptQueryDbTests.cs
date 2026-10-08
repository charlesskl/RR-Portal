using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryReceiptQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号] IN (N'ARQ-R1',N'ARQ-R2',N'ARQ-R3')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'ARQ-R1',N'ARQ-R2',N'ARQ-R3')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'ARQ-A1',N'ARQ-A2',N'ARQ-M1')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号] IN (N'ARQ-S1',N'ARQ-S2')");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'ARQ-S1',N'辅料入仓供应商一'),(N'ARQ-S2',N'辅料入仓供应商二')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ARQ-A1',N'辅料入仓胶纸A',N'辅料资料',N'2.5*90Y',N'卷')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ARQ-A2',N'辅料入仓胶纸B',N'辅料资料',N'30MM',N'PCS')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ARQ-M1',N'普通入仓布料',N'布料',N'100D',N'米')");

        c.Execute(@"INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[付款方式],[数量],[金额],[操作员],[审核])
                    VALUES(N'ARQ-R1','2026-07-02',N'ARQ-S1',N'辅料入仓供应商一',N'辅料仓库',N'人民币',10,20,N'tester','1'),
                          (N'ARQ-R2','2026-07-03',N'ARQ-S2',N'辅料入仓供应商二',N'辅料仓库',N'港币',4,12,N'tester','0'),
                          (N'ARQ-R3','2026-07-04',N'ARQ-S1',N'辅料入仓供应商一',N'物料仓',N'人民币',99,99,N'tester','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[条码号],[日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
                    VALUES(N'ARQ-R1',N'ARQ-PO1',N'ARQ-B1','2026-07-02',N'ARQ-S1',N'辅料入仓供应商一',N'辅料仓库',N'辅料资料',N'ARQ-A1',N'辅料入仓胶纸A',N'2.5*90Y',N'透明',N'卷',8,2,16,N'已审入仓备注'),
                          (N'ARQ-R1',N'ARQ-PO1',N'ARQ-B2','2026-07-02',N'ARQ-S1',N'辅料入仓供应商一',N'辅料仓库',N'辅料资料',N'ARQ-A1',N'辅料入仓胶纸A',N'2.5*90Y',N'透明',N'卷',2,2,4,N'已审入仓备注2'),
                          (N'ARQ-R2',N'ARQ-PO2',N'ARQ-B3','2026-07-03',N'ARQ-S2',N'辅料入仓供应商二',N'辅料仓库',N'辅料资料',N'ARQ-A2',N'辅料入仓胶纸B',N'30MM',N'透明',N'PCS',4,3,12,N'未审入仓备注'),
                          (N'ARQ-R3',N'ARQ-PO3',N'ARQ-B4','2026-07-04',N'ARQ-S1',N'辅料入仓供应商一',N'物料仓',N'布料',N'ARQ-M1',N'普通入仓布料',N'100D',N'蓝',N'米',99,1,99,N'不应出现')");
    }

    [SkippableFact]
    public async Task Auxiliary_receipt_summary_filters_auxiliary_and_can_group_by_supplier()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryReceiptQuerySummaryAsync(
                起: new DateTime(2026, 7, 1),
                止: new DateTime(2026, 7, 31),
                keyword: "胶纸",
                物料类别: null,
                日期类型: "日期",
                按供应商: false);

            Assert.Equal(2, rows.Count);
            var a = rows.Single(r => r.辅料编号 == "ARQ-A1");
            Assert.Null(a.供应商编号);
            Assert.Equal("辅料入仓胶纸A", a.辅料名称);
            Assert.Equal("2.5*90Y", a.规格);
            Assert.Equal("卷", a.单位);
            Assert.Equal(10m, a.入仓数量);
            Assert.DoesNotContain(rows, r => r.辅料编号 == "ARQ-M1");

            var bySupplier = await Svc().AuxiliaryReceiptQuerySummaryAsync(
                new DateTime(2026, 7, 1), new DateTime(2026, 7, 31),
                "ARQ-S1", null, "日期", 按供应商: true);
            var supplierRow = Assert.Single(bySupplier);
            Assert.Equal("ARQ-S1", supplierRow.供应商编号);
            Assert.Equal("辅料入仓供应商一", supplierRow.供应商名称);
            Assert.Equal(10m, supplierRow.入仓数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Auxiliary_receipt_detail_filters_audit_and_maps_receipt_fields()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var audited = await Svc().AuxiliaryReceiptQueryDetailAsync(
                起: new DateTime(2026, 7, 1),
                止: new DateTime(2026, 7, 31),
                keyword: "胶纸A",
                物料类别: null,
                日期类型: "日期",
                审核情况: "已审核");
            Assert.Equal(2, audited.Count);
            Assert.All(audited, r =>
            {
                Assert.Equal("ARQ-R1", r.入库单号);
                Assert.StartsWith("ARQ-B", r.单号);
                Assert.Equal("ARQ-PO1", r.订单单号);
                Assert.Equal("ARQ-S1", r.供应商编号);
                Assert.Equal("人民币", r.单价类型);
                Assert.Equal("1", r.审核);
            });

            var notAudited = await Svc().AuxiliaryReceiptQueryDetailAsync(
                起: null,
                止: null,
                keyword: "胶纸B",
                物料类别: null,
                日期类型: "日期",
                审核情况: "未审核");
            var row = Assert.Single(notAudited);
            Assert.Equal("ARQ-R2", row.入库单号);
            Assert.Equal("ARQ-B3", row.单号);
            Assert.Equal("ARQ-S2", row.供应商编号);
            Assert.Equal("港币", row.单价类型);
            Assert.Equal("未审入仓备注", row.备注);
            Assert.Equal("0", row.审核);
        }
        finally { Cleanup(c); }
    }
}
