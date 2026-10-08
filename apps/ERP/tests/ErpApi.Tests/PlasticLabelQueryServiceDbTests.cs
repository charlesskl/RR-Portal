using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticLabelQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task LabelQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'LQ_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'LQ_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'LQ-MO'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'LQPM01'");
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-LQ'");
        }
        Clean();
        c.Execute("INSERT INTO [款号总表]([款号]) VALUES(N'K-LQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'LQPM01',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号]) VALUES(N'LQ-MO',N'K-LQ')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[审核]) VALUES(N'LQ_D1','2026-06-10',N'LQ-MO',N'H-LQ','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[工模编号],[物料编号],[物料名称],[颜色],[订购数量],[备注]) VALUES(N'LQ_D1',N'LQ-MO',N'H-LQ',N'GM01',N'LQPM01',N'ABS粒',N'黑',5,N'b1'),(N'LQ_D1',N'LQ-MO',N'H-LQ',N'GM01',N'LQPM01',N'ABS粒',N'黑',3,N'b2')");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("K-LQ", r.款号); Assert.Equal("GM01", r.工模编号);
                Assert.Equal("H-LQ", r.塑胶货号); Assert.Equal("kg", r.单位); Assert.Equal("1", r.审核);
            });
            var sum = await Svc().LabelQuerySummaryAsync(qi, qe, "LQPM01", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "LQPM01");
            Assert.Equal("K-LQ", s.款号);
            Assert.Equal("GM01", s.工模编号);
            Assert.Equal("H-LQ", s.塑胶货号);
            Assert.Equal(8m, s.数量);          // 5+3
            Assert.Equal("kg", s.单位);
            // 审核情况
            Assert.Empty(await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", "未审核", null));
            Assert.Equal(2, (await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, "不存在类"));
            Assert.Equal(2, (await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().LabelQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "LQPM01", null, null));
        }
        finally { Clean(); }
    }
}
