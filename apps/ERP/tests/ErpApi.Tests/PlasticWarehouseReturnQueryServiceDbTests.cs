using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWarehouseReturnQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task WhReturnQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=N'WR_D1'");
            c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=N'WR_D1'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'WRPM'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'WRPM'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[塑胶货号],[共用原料编号]) VALUES(N'WRPM',N'H-WR',N'CR-WR')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'WRPM',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [塑胶退仓单]([单号],[日期],[供应商名称],[审核],[订单单号]) VALUES(N'WR_D1','2026-06-10',N'供B','1',N'ZCS-WR')");
        c.Execute("INSERT INTO [塑胶退仓明细单]([单号],[订单单号],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[颜色],[塑胶货号],[单位],[数量],[单价],[金额]) VALUES" +
            "(N'WR_D1',N'ZCS-WR',N'WR-MO',N'K-WR',N'GM-WR',N'WRPM',N'ABS粒',N'黑',N'H-WR',N'kg',5,2,10)," +
            "(N'WR_D1',N'ZCS-WR',N'WR-MO',N'K-WR',N'GM-WR',N'WRPM',N'ABS粒',N'黑',N'H-WR',N'kg',3,2,6)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().WhReturnQueryDetailAsync(qi, qe, "WRPM", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("ZCS-WR", r.订单单号); Assert.Equal("GM-WR", r.工模编号);
                Assert.Equal("供B", r.供应商); Assert.Equal("H-WR", r.共用货号);
                Assert.Equal("H-WR", r.塑胶货号); Assert.Equal("1", r.审核);
            });
            var sum = await Svc().WhReturnQuerySummaryAsync(qi, qe, "WRPM", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "WRPM");   // 汇总按物料编号·单行
            Assert.Equal("H-WR", s.共用货号);
            Assert.Equal("CR-WR", s.共用物料);
            Assert.Equal("ABS", s.物料类别);
            Assert.Equal(8m, s.数量);          // 5+3
            // 审核情况
            Assert.Empty(await Svc().WhReturnQueryDetailAsync(qi, qe, "WRPM", "未审核", null));
            Assert.Equal(2, (await Svc().WhReturnQueryDetailAsync(qi, qe, "WRPM", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().WhReturnQueryDetailAsync(qi, qe, "WRPM", null, "不存在类"));
            Assert.Equal(2, (await Svc().WhReturnQueryDetailAsync(qi, qe, "WRPM", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().WhReturnQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "WRPM", null, null));
        }
        finally { Clean(); }
    }
}
