using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

// 塑胶库存月报表(MonthlyAsync):指定月份 按物料 期初/本月入/本月出/期末,仅审核='1'。
[Collection("db")]
public class PlasticMonthlyReportDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    [SkippableFact]
    public async Task Monthly_splits_opening_in_out_by_month()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SMM01'; DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'SMM_R0',N'SMM_R1',N'SMM_R9')");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SMM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SMM_L1'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SMM01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[颜色]) VALUES(N'ABS',N'SMM01',N'ABS粒',N'黑')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SMM_R0','2026-05-20',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SMM_R0',N'进出仓',N'SMM01',N'ABS粒',N'kg',100)");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SMM_R1','2026-06-10',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SMM_R1',N'进出仓',N'SMM01',N'ABS粒',N'kg',50)");
        c.Execute("INSERT INTO [塑胶领料单]([单号],[日期],[仓库],[审核]) VALUES(N'SMM_L1','2026-06-12',N'进出仓','1')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SMM_L1',N'进出仓',N'SMM01',N'ABS粒',N'kg',20)");
        // 未审核入仓 99(不应计入)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SMM_R9','2026-06-15',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SMM_R9',N'进出仓',N'SMM01',N'ABS粒',N'kg',99)");
        try
        {
            var rows = await Svc().MonthlyAsync(new DateTime(2026, 6, 15), null, "SMM01");
            var r = Assert.Single(rows, x => x.物料编号 == "SMM01");
            Assert.Equal(100m, r.期初数量);
            Assert.Equal(50m, r.本期入库);
            Assert.Equal(20m, r.本期出库);
            Assert.Equal(130m, r.期末数量);
            Assert.Equal("黑", r.颜色);
            Assert.Equal("ABS", r.物料类别);
            // 物料类别过滤
            Assert.Single(await Svc().MonthlyAsync(new DateTime(2026, 6, 1), "ABS", "SMM01"));
            Assert.Empty(await Svc().MonthlyAsync(new DateTime(2026, 6, 1), "PP", "SMM01"));
            // 5 月:期初 0、入 100
            var may = Assert.Single(await Svc().MonthlyAsync(new DateTime(2026, 5, 1), null, "SMM01"), x => x.物料编号 == "SMM01");
            Assert.Equal(0m, may.期初数量);
            Assert.Equal(100m, may.本期入库);
        }
        finally { Clean(); }
    }
}
