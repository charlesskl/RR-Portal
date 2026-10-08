using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticStocktakeQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticStocktakeService Svc()
    {
        var f = Factory();
        return new PlasticStocktakeService(f, new DocumentNumberGenerator(), new PlasticInventoryService(f));
    }

    [SkippableFact]
    public async Task StocktakeQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [单号]=N'PD_D1'");
            c.Execute("DELETE FROM [塑胶盘点单] WHERE [单号]=N'PD_D1'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'PDPM'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PDPM'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[塑胶货号],[共用原料编号]) VALUES(N'PDPM',N'H-PD',N'CR-PD')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'ABS',N'PDPM',N'ABS粒',N'规A',N'kg',2)");
        c.Execute("INSERT INTO [塑胶盘点单]([单号],[日期],[仓库],[审核]) VALUES(N'PD_D1','2026-06-10',N'仓1','1')");
        c.Execute("INSERT INTO [塑胶盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[颜色],[单位],[系统数量],[盘点数量],[盈亏数量]) VALUES" +
            "(N'PD_D1','2026-06-10',N'仓1',N'PDPM',N'ABS粒',N'黑',N'kg',10,12,2)," +
            "(N'PD_D1','2026-06-10',N'仓1',N'PDPM',N'ABS粒',N'黑',N'kg',5,4,-1)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().StocktakeQueryDetailAsync(qi, qe, "PDPM", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("H-PD", r.塑胶货号);
                Assert.Equal("H-PD", r.共用货号);
                Assert.Equal(2m, r.单价);
                Assert.Equal("1", r.审核);
                // 金额 = 盈亏 × 单价
                Assert.Equal((r.盈亏数量 ?? 0) * 2m, r.金额);
            });
            var r1 = Assert.Single(det, x => x.系统数量 == 10m);
            Assert.Equal(12m, r1.盘点数量); Assert.Equal(2m, r1.盈亏数量); Assert.Equal(4m, r1.金额);
            var r2 = Assert.Single(det, x => x.系统数量 == 5m);
            Assert.Equal(4m, r2.盘点数量); Assert.Equal(-1m, r2.盈亏数量); Assert.Equal(-2m, r2.金额);

            var sum = await Svc().StocktakeQuerySummaryAsync(qi, qe, "PDPM", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "PDPM");   // 汇总按物料编号·单行
            Assert.Equal("H-PD", s.塑胶货号);
            Assert.Equal("ABS", s.物料类别);
            Assert.Equal(15m, s.系统数量);   // 10+5
            Assert.Equal(16m, s.盘点数量);   // 12+4
            Assert.Equal(1m, s.盈亏数量);    // 2+(-1)
            Assert.Equal(2m, s.金额);        // 4+(-2)
            Assert.Equal(2m, s.单价);

            // 审核情况
            Assert.Empty(await Svc().StocktakeQueryDetailAsync(qi, qe, "PDPM", "未审核", null));
            Assert.Equal(2, (await Svc().StocktakeQueryDetailAsync(qi, qe, "PDPM", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().StocktakeQueryDetailAsync(qi, qe, "PDPM", null, "不存在类"));
            Assert.Equal(2, (await Svc().StocktakeQueryDetailAsync(qi, qe, "PDPM", null, "ABS")).Count);
            // keyword
            Assert.Empty(await Svc().StocktakeQueryDetailAsync(qi, qe, "ZZZ", null, null));
            // 区间外
            Assert.Empty(await Svc().StocktakeQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "PDPM", null, null));
        }
        finally { Clean(); }
    }
}
