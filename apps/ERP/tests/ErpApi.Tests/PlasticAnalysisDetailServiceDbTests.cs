using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticAnalysisDetailServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task AnalysisDetail_joins_kuanhao_material_done_and_filters()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'PAD_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'PAD_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'PAD-MO1'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PADPM01'");
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-AD'");
        }
        Clean();
        c.Execute("IF NOT EXISTS(SELECT 1 FROM [款号总表] WHERE [款号]=N'K-AD') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K-AD',N'塑胶分析测试款')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[单位]) VALUES(N'ABS',N'PADPM01',N'ABS粒',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[完成]) VALUES(N'PAD-MO1',N'K-AD',N'是')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号]) VALUES(N'PAD_D1','2026-06-10',N'PAD-MO1',N'H-AD')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[物料编号],[物料名称],[颜色],[加工内容],[订购数量],[加工单价],[金额]) VALUES(N'PAD_D1',N'PAD-MO1',N'H-AD',N'PADPM01',N'ABS粒',N'黑',N'原胶件',8,5,40)");
        try
        {
            var rows = await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, null);
            var r = Assert.Single(rows, x => x.物料编号 == "PADPM01");
            Assert.Equal("K-AD", r.款号);
            Assert.Equal("H-AD", r.货号);
            Assert.Equal("ABS", r.材料);
            Assert.Equal("kg", r.单位);
            Assert.Equal("原胶件", r.加工内容);
            Assert.Equal(8m, r.数量);
            Assert.Equal(5m, r.加工单价);
            Assert.Equal(40m, r.金额);
            Assert.Equal("是", r.完成);
            Assert.Empty(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "PADPM01", "否"));
            Assert.Single(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "PADPM01", "是"));
            Assert.Single(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "K-AD", null));
            Assert.Empty(await Svc().AnalysisDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "PADPM01", null));
        }
        finally { Clean(); }
    }
}
