using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessPurchaseProgressServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticProcessPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-PRG-1','2026-06-15',N'F-PR',N'PR测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-PRG-1',N'PJ-PR',N'K-PR',N'GM-PR',N'PRPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PRPM',N'白件A',N'个')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'SR-PRG-1','2026-06-20','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量],[单价],[金额]) VALUES(N'SR-PRG-1',N'PJ-PR',N'PRPM',N'白件A',N'黑',5,3,15)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-PRG-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-PRG-1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'SR-PRG-1'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SR-PRG-1'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PRPM'");
    }

    [SkippableFact]
    public async Task Progress_orders_minus_receipts()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().ProgressAsync(null, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, false);
            var r = Assert.Single(rows.Where(x => x.加工采购单号 == "SJ-PRG-1"));
            Assert.Equal(8m, r.订购数量);
            Assert.Equal(5m, r.入仓数量);
            Assert.Equal(3m, r.剩余数量);
            Assert.Equal(24m, r.订购金额);
            Assert.Equal(15m, r.入仓金额);
            Assert.Equal(9m, r.剩余金额);
            Assert.Equal("个", r.单位);
            Assert.Equal("喷油", r.加工内容);
            Assert.Equal("PR测试加工厂", r.加工厂名称);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Progress_filters_onlyOwed_and_factory_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var owed = await Svc().ProgressAsync(null, null, null, null, true);
            Assert.Contains(owed, x => x.加工采购单号 == "SJ-PRG-1");
            var hit = await Svc().ProgressAsync("PR测试", null, null, null, false);
            Assert.Contains(hit, x => x.加工采购单号 == "SJ-PRG-1");
            var miss = await Svc().ProgressAsync("不存在的厂", null, null, null, false);
            Assert.DoesNotContain(miss, x => x.加工采购单号 == "SJ-PRG-1");
            var kw = await Svc().ProgressAsync(null, null, null, "PJ-PR", false);
            Assert.Contains(kw, x => x.加工采购单号 == "SJ-PRG-1");
        }
        finally { Clean(c); }
    }
}
