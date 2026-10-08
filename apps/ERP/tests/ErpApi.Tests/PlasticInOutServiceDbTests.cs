using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticInOutServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    [SkippableFact]
    public async Task InOut_splits_opening_in_out_by_doc_date()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIOM01'; DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'SIO_R0',N'SIO_R1')");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIOM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SIO_L1'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SIOM01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[颜色]) VALUES(N'ABS',N'SIOM01',N'ABS粒',N'黑')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_R0','2026-05-20',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_R0',N'进出仓',N'SIOM01',N'ABS粒',N'kg',100)");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_R1','2026-06-10',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_R1',N'进出仓',N'SIOM01',N'ABS粒',N'kg',50)");
        c.Execute("INSERT INTO [塑胶领料单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_L1','2026-06-12',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_L1',N'进出仓',N'SIOM01',N'ABS粒',N'kg',20)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SIO_R0", "t");
            await engine.ApproveAsync("塑胶入仓单", "SIO_R1", "t");
            await engine.ApproveAsync("塑胶领料单", "SIO_L1", "t");
            var rows = await Svc().InOutAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "进出仓", "SIOM01");
            var r = Assert.Single(rows, x => x.物料编号 == "SIOM01");
            Assert.Equal(100m, r.期初数量);
            Assert.Equal(50m, r.本期入库);
            Assert.Equal(20m, r.本期出库);
            Assert.Equal(130m, r.期末数量);
            Assert.Equal("黑", r.颜色);
            Assert.Equal("ABS", r.物料类别);
            await engine.UnapproveAsync("塑胶入仓单", "SIO_R1", "t");
            var rows2 = await Svc().InOutAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "进出仓", "SIOM01");
            Assert.Equal(0m, Assert.Single(rows2, x => x.物料编号 == "SIOM01").本期入库);
        }
        finally { Clean(); }
    }
}
