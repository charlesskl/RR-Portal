using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticInventoryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRINV01',N'塑胶仓','0')");
        c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'SRINV01',N'塑胶仓',N'SIPM01',N'ABS粒',N'规A',N'kg',100)");
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIPM01'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRINV01'");
    }

    [SkippableFact]
    public async Task Stock_zero_until_approved_then_plus_then_reverses()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            Assert.Equal(0m, await Svc().StockOfAsync("SIPM01", null));

            Assert.True(await engine.ApproveAsync("塑胶入仓单", "SRINV01", "tester"));
            Assert.Equal(100m, await Svc().StockOfAsync("SIPM01", null));
            var list = await Svc().ListAsync("塑胶仓", "SIPM01");
            Assert.Contains(list, r => r.物料编号 == "SIPM01" && r.库存数量 == 100m && r.仓库 == "塑胶仓");

            Assert.True(await engine.UnapproveAsync("塑胶入仓单", "SRINV01", "tester"));
            Assert.Equal(0m, await Svc().StockOfAsync("SIPM01", null));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Issue_minus_and_Return_plus_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRIR01'");
        c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SLLIR01'");
        c.Execute("DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶退料单] WHERE [单号]=N'STLIR01'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRIR01',N'塑胶仓',N'SIRPM01',100)");
        c.Execute("INSERT INTO [塑胶领料单]([单号],[仓库],[审核]) VALUES(N'SLLIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SLLIR01',N'塑胶仓',N'SIRPM01',30)");
        c.Execute("INSERT INTO [塑胶退料单]([单号],[仓库],[审核]) VALUES(N'STLIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶退料明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'STLIR01',N'塑胶仓',N'SIRPM01',10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRIR01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SIRPM01", null));
            await engine.ApproveAsync("塑胶领料单", "SLLIR01", "t");
            Assert.Equal(70m, await Svc().StockOfAsync("SIRPM01", null));
            await engine.ApproveAsync("塑胶退料单", "STLIR01", "t");
            Assert.Equal(80m, await Svc().StockOfAsync("SIRPM01", null));
        }
        finally
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRIR01'");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SLLIR01'");
            c.Execute("DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶退料单] WHERE [单号]=N'STLIR01'");
        }
    }

    [SkippableFact]
    public async Task WarehouseReturn_minus_and_Scrap_minus_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRWS01'");
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶退仓单] WHERE [单号]=N'STCWS01'");
            c.Execute("DELETE FROM [塑胶报废明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶报废单] WHERE [单号]=N'SBFWS01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRWS01',N'塑胶仓',N'SWSPM01',100)");
        c.Execute("INSERT INTO [塑胶退仓单]([单号],[仓库],[审核]) VALUES(N'STCWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶退仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'STCWS01',N'塑胶仓',N'SWSPM01',20)");
        c.Execute("INSERT INTO [塑胶报废单]([单号],[仓库],[审核]) VALUES(N'SBFWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶报废明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SBFWS01',N'塑胶仓',N'SWSPM01',10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRWS01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SWSPM01", null));
            await engine.ApproveAsync("塑胶退仓单", "STCWS01", "t");
            Assert.Equal(80m, await Svc().StockOfAsync("SWSPM01", null));
            await engine.ApproveAsync("塑胶报废单", "SBFWS01", "t");
            Assert.Equal(70m, await Svc().StockOfAsync("SWSPM01", null));
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task Stocktake_signed_盈亏_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDINV01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPDI01'");
            c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [物料编号]=N'SPDINV01'; DELETE FROM [塑胶盘点单] WHERE [单号]=N'SPDPDI01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPDI01',N'盘点仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRPDI01',N'盘点仓',N'SPDINV01',100)");
        c.Execute("INSERT INTO [塑胶盘点单]([单号],[仓库],[审核]) VALUES(N'SPDPDI01',N'盘点仓','0')");
        c.Execute("INSERT INTO [塑胶盘点明细单]([单号],[仓库],[物料编号],[系统数量],[盘点数量],[盈亏数量]) VALUES(N'SPDPDI01',N'盘点仓',N'SPDINV01',100,90,-10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRPDI01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SPDINV01", null));
            await engine.ApproveAsync("塑胶盘点单", "SPDPDI01", "t");
            Assert.Equal(90m, await Svc().StockOfAsync("SPDINV01", null));
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task WhitePartIssue_minus_from_塑胶仓_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'WPIP01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRWPI01'");
            c.Execute("DELETE FROM [白件领料明细单] WHERE [物料编号]=N'WPIP01'; DELETE FROM [白件领料单] WHERE [单号]=N'BJLWPI01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRWPI01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRWPI01',N'塑胶仓',N'WPIP01',100)");
        c.Execute("INSERT INTO [白件领料单]([单号],[审核]) VALUES(N'BJLWPI01','0')");
        c.Execute("INSERT INTO [白件领料明细单]([单号],[物料编号],[数量]) VALUES(N'BJLWPI01',N'WPIP01',40)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRWPI01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("WPIP01", null));
            // 白件领料(发外喷油)审核 → 扣塑胶仓库存
            await engine.ApproveAsync("白件领料单", "BJLWPI01", "t");
            Assert.Equal(60m, await Svc().StockOfAsync("WPIP01", null));
            var list = await Svc().ListAsync("塑胶仓", "WPIP01");
            Assert.Contains(list, r => r.物料编号 == "WPIP01" && r.库存数量 == 60m && r.仓库 == "塑胶仓");
            // 反审核回冲
            Assert.True(await engine.UnapproveAsync("白件领料单", "BJLWPI01", "t"));
            Assert.Equal(100m, await Svc().StockOfAsync("WPIP01", null));
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task List_brings_join_columns_and_filters_by_category()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SINVR01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRINVR01'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SINVR01'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'SINVR01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单价]) VALUES(N'ABS',N'SINVR01',N'ABS粒',N'规A',N'黑',N'A-1',10)");
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[工模编号],[塑胶货号]) VALUES(N'SINVR01',N'MJ-1',N'HH-1')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRINVR01',N'报表仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRINVR01',N'报表仓',N'SINVR01',N'ABS粒',N'规A',N'kg',100)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRINVR01", "t");
            var rows = await Svc().ListAsync("报表仓", "SINVR01");
            var row = Assert.Single(rows, r => r.物料编号 == "SINVR01");
            Assert.Equal("黑", row.颜色);
            Assert.Equal("MJ-1", row.工模编号);
            Assert.Equal("HH-1", row.塑胶货号);
            Assert.Equal("ABS", row.物料类别);
            Assert.Equal(10m, row.单价);
            Assert.Equal(1000m, row.金额);
            Assert.Empty(await Svc().ListAsync("报表仓", "SINVR01", "不存在类"));
            Assert.Single(await Svc().ListAsync("报表仓", "SINVR01", "ABS"));
        }
        finally { Clean(); }
    }
}
