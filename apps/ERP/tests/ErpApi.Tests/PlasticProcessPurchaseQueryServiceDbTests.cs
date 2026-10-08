using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessPurchaseQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticProcessPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task ProcessPurchaseQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'GQ_D1'");
            c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'GQ_D1'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'GQPM'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'GQPM'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[塑胶货号],[共用原料编号]) VALUES(N'GQPM',N'H-GQ',N'CR-GQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'GQPM',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂名称],[客户名称],[审核]) VALUES(N'GQ_D1','2026-06-10',N'甲厂',N'客A','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES" +
            "(N'GQ_D1',N'GQ-MO',N'K-GQ',N'GM-GQ',N'GQPM',N'ABS粒',N'用料A',N'黑',N'喷油',5,2,10)," +
            "(N'GQ_D1',N'GQ-MO',N'K-GQ',N'GM-GQ',N'GQPM',N'ABS粒',N'用料A',N'黑',N'喷油',3,2,6)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().QueryDetailAsync(qi, qe, "GQPM", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("甲厂", r.加工厂名称); Assert.Equal("GM-GQ", r.模具编号);
                Assert.Equal("喷油", r.加工内容); Assert.Equal("kg", r.单位);
                Assert.Equal("1", r.审核);
            });
            var sum = await Svc().QuerySummaryAsync(qi, qe, "GQPM", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "GQPM");   // 汇总按模具+物料+颜色+加工内容·单行
            Assert.Equal("CR-GQ", s.共用物料);
            Assert.Equal("ABS", s.物料类别);
            Assert.Equal("kg", s.单位);
            Assert.Equal(8m, s.订购数量);   // 5+3
            Assert.Equal(16m, s.总金额);    // 10+6
            // 审核情况
            Assert.Empty(await Svc().QueryDetailAsync(qi, qe, "GQPM", "未审核", null));
            Assert.Equal(2, (await Svc().QueryDetailAsync(qi, qe, "GQPM", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().QueryDetailAsync(qi, qe, "GQPM", null, "不存在类"));
            Assert.Equal(2, (await Svc().QueryDetailAsync(qi, qe, "GQPM", null, "ABS")).Count);
            // keyword
            Assert.Equal(2, (await Svc().QueryDetailAsync(qi, qe, "GQ-MO", null, null)).Count);
            // 区间外
            Assert.Empty(await Svc().QueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "GQPM", null, null));
        }
        finally { Clean(); }
    }
}
