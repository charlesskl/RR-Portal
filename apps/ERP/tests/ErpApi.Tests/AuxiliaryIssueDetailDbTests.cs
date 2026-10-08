using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.MaterialIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuxiliaryIssueDetailDbTests(DbFixture fx)
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
        c.Execute("DELETE FROM [领料明细单] WHERE [单号] IN (N'AID-L1',N'AID-L2',N'AID-L3')");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'AID-L1',N'AID-L2',N'AID-L3')");
        c.Execute("DELETE FROM [生产通知单MO单] WHERE [生产单号]=N'AID-MO1'");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'AID-K1'");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'AID-K1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'AID-K1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'AID-A1',N'AID-A2',N'AID-M1')");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'AID-A1',N'辅料胶纸A',N'辅料资料',N'2.5*90Y',N'卷')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'AID-A2',N'辅料胶纸B',N'辅料资料',N'30MM',N'PCS')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[物料类别],[规格],[单位]) VALUES(N'AID-M1',N'普通布料',N'布料',N'100D',N'米')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'AID-K1',N'辅料出库测试款')");
        c.Execute(@"INSERT INTO [款号物料总表]([日期],[款号],[款式],[产品编号],[使用数量],[制作要求],[审核])
                    VALUES('2026-07-01',N'AID-K1',N'辅料出库测试款',N'BBA-AID',10,N'组装半成品',N'1')");
        c.Execute(@"INSERT INTO [款号物料明细表]([日期],[款号],[款式],[物料类别],[物料编号],[物料名称],[规格],[单位],[使用数量])
                    VALUES('2026-07-01',N'AID-K1',N'辅料出库测试款',N'辅料资料',N'AID-A1',N'辅料胶纸A',N'2.5*90Y',N'卷',1),
                          ('2026-07-01',N'AID-K1',N'辅料出库测试款',N'辅料资料',N'AID-A2',N'30MM辅料胶纸B',N'30MM',N'PCS',0.4),
                          ('2026-07-01',N'AID-K1',N'辅料出库测试款',N'布料',N'AID-M1',N'普通布料',N'100D',N'米',8)");
        c.Execute(@"INSERT INTO [生产通知单MO单]([生产单号],[序号],[接单日期],[产品货号],[产品名称],[接单数量])
                    VALUES(N'AID-MO1',1,'2026-07-02',N'AID-K1',N'辅料出库测试款',10)");
        c.Execute(@"INSERT INTO [领料单]([单号],[日期],[仓库],[数量],[金额],[操作员],[审核],[备注])
                    VALUES(N'AID-L1','2026-07-03',N'辅料仓库',3,0,N'tester',N'1',N'生产领料'),
                          (N'AID-L2','2026-07-04',N'辅料仓库',2,0,N'tester',N'1',N'生产领料'),
                          (N'AID-L3','2026-07-05',N'辅料仓库',10,0,N'tester',N'0',N'生产领料')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号])
                    VALUES(N'AID-L1','2026-07-03',N'辅料仓库',N'辅料资料',N'AID-A1',N'辅料胶纸A',N'2.5*90Y',N'卷',3,0,0,N'生产领料',N'AID-MO1',N'AID-K1'),
                          (N'AID-L2','2026-07-04',N'辅料仓库',N'辅料资料',N'AID-A1',N'辅料胶纸A',N'2.5*90Y',N'卷',2,0,0,N'生产领料',N'AID-MO1',N'AID-K1'),
                          (N'AID-L3','2026-07-05',N'辅料仓库',N'辅料资料',N'AID-A1',N'辅料胶纸A',N'2.5*90Y',N'卷',10,0,0,N'生产领料',N'AID-MO1',N'AID-K1')");
    }

    [SkippableFact]
    public async Task Auxiliary_issue_detail_expands_issue_lines_and_calculates_total_and_difference()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().AuxiliaryIssueDetailAsync("未到", null, null, "胶纸", null, "全部");

            Assert.Equal(3, rows.Count);
            Assert.DoesNotContain(rows, r => r.辅料编号 == "AID-M1");

            var issuedRows = rows
                .Where(r => r.辅料编号 == "AID-A1")
                .OrderBy(r => r.领料日期)
                .ToList();
            Assert.Equal(2, issuedRows.Count);
            Assert.Equal("AID-L1", issuedRows[0].领料单号);
            Assert.Equal(3m, issuedRows[0].领料数量);
            Assert.Equal(5m, issuedRows[0].合计已领数量);
            Assert.Equal(5m, issuedRows[0].未领数量);

            var notIssued = Assert.Single(rows, r => r.辅料编号 == "AID-A2");
            Assert.Null(notIssued.领料单号);
            Assert.Null(notIssued.领料日期);
            Assert.Equal(0m, notIssued.合计已领数量);
            Assert.Equal(4m, notIssued.未领数量);

            var completeRows = await Svc().AuxiliaryIssueDetailAsync("已到", null, null, "胶纸", null, "全部");
            Assert.Empty(completeRows);

            var remarkRows = await Svc().AuxiliaryIssueDetailAsync("未到", null, null, "胶纸", null, "生产领料");
            Assert.Equal(3, remarkRows.Count);
        }
        finally { Cleanup(c); }
    }
}
