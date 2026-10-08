using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.MaterialIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryStockIssueQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [领料明细单] WHERE [单号] IN (N'ASIQ-I1',N'ASIQ-I2',N'ASIQ-I3')");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'ASIQ-I1',N'ASIQ-I2',N'ASIQ-I3')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'ASIQ-A1',N'ASIQ-A2',N'ASIQ-M1')");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ASIQ-A1',N'辅料出库胶纸A',N'辅料资料',N'2.5*90Y',N'卷')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ASIQ-A2',N'辅料出库扎带B',N'辅料资料',N'30MM',N'PCS')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'ASIQ-M1',N'普通领料布料',N'布料',N'100D',N'米')");

        c.Execute(@"INSERT INTO [领料单]([单号],[日期],[生产单号],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[备注])
                    VALUES(N'ASIQ-I1','2026-07-02',N'ASIQ-MO1',N'装配一部',N'王军',N'辅料仓库',10,0,N'何明武',N'1',N'生产领料'),
                          (N'ASIQ-I2','2026-07-03',N'ASIQ-MO2',N'装配二部',N'李四',N'辅料仓库',4,0,N'马玮玮',N'0',N'样板领料'),
                          (N'ASIQ-I3','2026-07-04',N'ASIQ-MO3',N'裁床部',N'张三',N'物料仓',99,0,N'何明武',N'1',N'生产领料')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[日期],[生产单号],[领料部门],[领料人],[仓库],[物料类别],[物料编号],[物料名称],[规格],[单位],[数量],[备注])
                    VALUES(N'ASIQ-I1','2026-07-02',N'ASIQ-MO1',N'装配一部',N'王军',N'辅料仓库',N'辅料资料',N'ASIQ-A1',N'辅料出库胶纸A',N'2.5*90Y',N'卷',8,N'生产领料'),
                          (N'ASIQ-I1','2026-07-02',N'ASIQ-MO1',N'装配一部',N'王军',N'辅料仓库',N'辅料资料',N'ASIQ-A1',N'辅料出库胶纸A',N'2.5*90Y',N'卷',2,N'生产领料'),
                          (N'ASIQ-I2','2026-07-03',N'ASIQ-MO2',N'装配二部',N'李四',N'辅料仓库',N'辅料资料',N'ASIQ-A2',N'辅料出库扎带B',N'30MM',N'PCS',4,N'样板领料'),
                          (N'ASIQ-I3','2026-07-04',N'ASIQ-MO3',N'裁床部',N'张三',N'物料仓',N'布料',N'ASIQ-M1',N'普通领料布料',N'100D',N'米',99,N'不应出现')");
    }

    [SkippableFact]
    public async Task Auxiliary_stock_issue_summary_filters_auxiliary_and_groups_by_remark()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryStockIssueQuerySummaryAsync(
                起: new DateTime(2026, 7, 1),
                止: new DateTime(2026, 7, 31),
                keyword: "胶纸",
                物料类别: null,
                日期类型: "日期",
                领料备注: "生产领料");

            var row = Assert.Single(rows);
            Assert.Equal("生产领料", row.领料备注);
            Assert.Equal(new DateTime(2026, 7, 2), row.开单日期);
            Assert.Equal("ASIQ-MO1", row.装配生产单号);
            Assert.Equal("ASIQ-A1", row.辅料编号);
            Assert.Equal("辅料出库胶纸A", row.辅料名称);
            Assert.Equal("2.5*90Y", row.规格);
            Assert.Equal("卷", row.单位);
            Assert.Equal(10m, row.领料数量);
            Assert.DoesNotContain(rows, r => r.辅料编号 == "ASIQ-M1");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Auxiliary_stock_issue_detail_filters_audit_maker_and_maps_document_fields()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var audited = await Svc().AuxiliaryStockIssueQueryDetailAsync(
                起: new DateTime(2026, 7, 1),
                止: new DateTime(2026, 7, 31),
                keyword: "胶纸",
                物料类别: null,
                日期类型: "日期",
                领料备注: "生产领料",
                制单人: "何明武",
                审核情况: "已审核");
            Assert.Equal(2, audited.Count);
            Assert.All(audited, r =>
            {
                Assert.Equal("生产领料", r.领料备注);
                Assert.Equal("ASIQ-I1", r.单号);
                Assert.Equal("ASIQ-MO1", r.装配生产单号);
                Assert.Equal("装配一部", r.生产车间);
                Assert.Equal("王军", r.领料人);
                Assert.Equal("何明武", r.制单人);
                Assert.Equal("1", r.审核);
            });

            var notAudited = await Svc().AuxiliaryStockIssueQueryDetailAsync(
                起: null,
                止: null,
                keyword: "扎带",
                物料类别: null,
                日期类型: "日期",
                领料备注: null,
                制单人: null,
                审核情况: "未审核");
            var row = Assert.Single(notAudited);
            Assert.Equal("ASIQ-I2", row.单号);
            Assert.Equal("样板领料", row.领料备注);
            Assert.Equal("辅料出库扎带B", row.辅料名称);
            Assert.Equal(4m, row.数量);
            Assert.Equal("0", row.审核);
        }
        finally { Cleanup(c); }
    }
}
