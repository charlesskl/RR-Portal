using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReturnQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task ReturnQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶退料明细单] WHERE [单号]=N'RQ_D1'");
            c.Execute("DELETE FROM [塑胶退料单] WHERE [单号]=N'RQ_D1'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'RQPM01'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'RQPM01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[塑胶货号],[共用原料编号]) VALUES(N'RQPM01',N'H-RQ',N'CR-RQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'RQPM01',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [塑胶退料单]([单号],[日期],[退料部门],[退料人],[审核]) VALUES(N'RQ_D1','2026-06-10',N'D1',N'P1','1')");
        c.Execute("INSERT INTO [塑胶退料明细单]([单号],[生产单号],[款号],[物料编号],[物料名称],[颜色],[塑胶货号],[单位],[数量],[单价],[金额]) VALUES" +
            "(N'RQ_D1',N'RQ-MO',N'K-RQ',N'RQPM01',N'ABS粒',N'黑',N'H-RQ',N'kg',5,2,10)," +
            "(N'RQ_D1',N'RQ-MO',N'K-RQ',N'RQPM01',N'ABS粒',N'黑',N'H-RQ',N'kg',3,2,6)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().ReturnQueryDetailAsync(qi, qe, "RQPM01", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("H-RQ", r.共用货号); Assert.Equal("CR-RQ", r.共用物料);
                Assert.Equal("H-RQ", r.塑胶货号); Assert.Equal("D1", r.退料部门);
                Assert.Equal("P1", r.退料人); Assert.Equal("1", r.审核);
            });
            var sum = await Svc().ReturnQuerySummaryAsync(qi, qe, "RQPM01", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "RQPM01");
            Assert.Equal("RQ-MO", s.生产单号);
            Assert.Equal("H-RQ", s.共用货号);
            Assert.Equal("CR-RQ", s.共用物料);
            Assert.Equal("ABS", s.物料类别);
            Assert.Equal(8m, s.数量);          // 5+3
            // 审核情况
            Assert.Empty(await Svc().ReturnQueryDetailAsync(qi, qe, "RQPM01", "未审核", null));
            Assert.Equal(2, (await Svc().ReturnQueryDetailAsync(qi, qe, "RQPM01", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().ReturnQueryDetailAsync(qi, qe, "RQPM01", null, "不存在类"));
            Assert.Equal(2, (await Svc().ReturnQueryDetailAsync(qi, qe, "RQPM01", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().ReturnQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "RQPM01", null, null));
        }
        finally { Clean(); }
    }
}
