using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

// 塑胶物料进出汇总(InOutSummaryAsync):按物料一行汇总区间内 入仓/退仓/领料/退料/报废/盘点盈亏,仅审核='1'。
[Collection("db")]
public class PlasticInOutSummaryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    [SkippableFact]
    public async Task InOutSummary_pivots_doc_types_per_material()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'SIOS_R',N'SIOS_R0',N'SIOS_RX')");
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶退仓单] WHERE [单号]=N'SIOS_W'");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SIOS_L'");
            c.Execute("DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶退料单] WHERE [单号]=N'SIOS_T'");
            c.Execute("DELETE FROM [塑胶报废明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶报废单] WHERE [单号]=N'SIOS_B'");
            c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [物料编号]=N'SIOS01'; DELETE FROM [塑胶盘点单] WHERE [单号]=N'SIOS_P'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SIOS01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[颜色]) VALUES(N'ABS',N'SIOS01',N'ABS粒',N'黑')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_R','2026-06-05',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_R',N'进出仓',N'SIOS01',N'ABS粒',N'kg',100)");
        c.Execute("INSERT INTO [塑胶退仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_W','2026-06-06',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶退仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_W',N'进出仓',N'SIOS01',N'ABS粒',N'kg',7)");
        c.Execute("INSERT INTO [塑胶领料单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_L','2026-06-07',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_L',N'进出仓',N'SIOS01',N'ABS粒',N'kg',20)");
        c.Execute("INSERT INTO [塑胶退料单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_T','2026-06-08',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶退料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_T',N'进出仓',N'SIOS01',N'ABS粒',N'kg',5)");
        c.Execute("INSERT INTO [塑胶报废单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_B','2026-06-09',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶报废明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_B',N'进出仓',N'SIOS01',N'ABS粒',N'kg',3)");
        c.Execute("INSERT INTO [塑胶盘点单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_P','2026-06-10',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶盘点明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[系统数量],[盘点数量],[盈亏数量]) VALUES(N'SIOS_P',N'进出仓',N'SIOS01',N'ABS粒',N'kg',100,98,-2)");
        // 未审核入仓 99(不应计入) + 区间外入仓 50(不应计入)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_R0','2026-06-11',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_R0',N'进出仓',N'SIOS01',N'ABS粒',N'kg',99)");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIOS_RX','2026-05-01',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIOS_RX',N'进出仓',N'SIOS01',N'ABS粒',N'kg',50)");
        try
        {
            var rows = await Svc().InOutSummaryAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, "SIOS01");
            var r = Assert.Single(rows, x => x.物料编号 == "SIOS01");
            Assert.Equal(100m, r.入仓);
            Assert.Equal(7m, r.退仓);
            Assert.Equal(20m, r.领料);
            Assert.Equal(5m, r.退料);
            Assert.Equal(3m, r.报废);
            Assert.Equal(-2m, r.盘点盈亏);
            Assert.Equal("ABS", r.物料类别);
            // 物料类别过滤 + 区间过滤
            Assert.Single(await Svc().InOutSummaryAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "ABS", "SIOS01"));
            Assert.Empty(await Svc().InOutSummaryAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "PP", "SIOS01"));
            var may = Assert.Single(await Svc().InOutSummaryAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), null, "SIOS01"), x => x.物料编号 == "SIOS01");
            Assert.Equal(50m, may.入仓);
            Assert.Equal(0m, may.领料);
        }
        finally { Clean(); }
    }
}
