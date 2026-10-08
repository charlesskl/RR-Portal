using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticOrderQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task OrderQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'OQ_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'OQ_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'OQ-MO'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'OQPM01'");
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-OQ'");
        }
        Clean();
        c.Execute("INSERT INTO [款号总表]([款号]) VALUES(N'K-OQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'OQPM01',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号]) VALUES(N'OQ-MO',N'K-OQ')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[审核]) VALUES(N'OQ_D1','2026-06-10',N'OQ-MO',N'H-OQ','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[物料编号],[物料名称],[颜色],[订购数量],[加工单价],[金额]) VALUES(N'OQ_D1',N'OQ-MO',N'H-OQ',N'OQPM01',N'ABS粒',N'黑',5,5,25),(N'OQ_D1',N'OQ-MO',N'H-OQ',N'OQPM01',N'ABS粒',N'黑',3,5,15)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => { Assert.Equal("K-OQ", r.款号); Assert.Equal("ABS", r.材料); Assert.Equal("规A", r.规格); Assert.Equal("1", r.审核); });
            var sum = await Svc().OrderQuerySummaryAsync(qi, qe, "OQPM01", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "OQPM01");
            Assert.Equal(8m, s.数量);          // 5+3
            Assert.Equal(40m, s.金额);         // 25+15
            Assert.Equal("ABS", s.物料类别);
            // 审核情况
            Assert.Empty(await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", "未审核", null));
            Assert.Equal(2, (await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, "不存在类"));
            Assert.Equal(2, (await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().OrderQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "OQPM01", null, null));
        }
        finally { Clean(); }
    }
}
