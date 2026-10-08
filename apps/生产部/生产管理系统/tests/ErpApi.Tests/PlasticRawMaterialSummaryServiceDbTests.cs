using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialSummaryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    // 原料本月库存汇总(新台账口径):原料入/出库单据(仅审核)按原料名称汇总;
    // 存外厂/原料报废暂无来源→0,本月总数=本月库存
    [SkippableFact]
    public async Task RawMaterialSummary_current_stock_plus_period_scrap()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [原料入仓明细单] WHERE [原料名称]=N'RAWNAME'; DELETE FROM [原料入仓单] WHERE [单号]=N'RAW_R1'");
            c.Execute("DELETE FROM [原料出库明细单] WHERE [原料名称]=N'RAWNAME'; DELETE FROM [原料出库单] WHERE [单号]=N'RAW_I1'");
        }
        Clean();
        c.Execute("INSERT INTO [原料入仓单]([单号],[日期],[审核]) VALUES(N'RAW_R1','2026-06-05','1')");
        c.Execute("INSERT INTO [原料入仓明细单]([单号],[原料编号],[原料名称],[每包重量],[单位],[数量]) VALUES(N'RAW_R1',N'RAWPM01',N'RAWNAME',25,N'包',100)");
        c.Execute("INSERT INTO [原料出库单]([单号],[日期],[审核]) VALUES(N'RAW_I1','2026-06-12','1')");
        c.Execute("INSERT INTO [原料出库明细单]([单号],[原料编号],[原料名称],[每包重量],[单位],[数量]) VALUES(N'RAW_I1',N'RAWPM01',N'RAWNAME',25,N'包',30)");
        try
        {
            var rows = await Svc().RawMaterialMonthlySummaryAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "RAWNAME");
            var r = Assert.Single(rows, x => x.原料名称 == "RAWNAME");
            Assert.Equal(70m, r.本月库存);        // 入100 − 出30
            Assert.Equal(1750m, r.本月库存重量);  // 70 × 每包25
            Assert.Equal(0m, r.存外厂数量);
            Assert.Equal(0m, r.本月报废);         // 原料报废单暂无 → 0
            Assert.Equal(70m, r.本月总数);        // = 本月库存
        }
        finally { Clean(); }
    }
}
