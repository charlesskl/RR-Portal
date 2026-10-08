using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessPurchaseDetailServiceDbTests(DbFixture fx)
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
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-PD-1','2026-06-15',N'F-PD',N'PD测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-PD-1',N'PJ-PD',N'K-PD',N'GM-PD',N'PDPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PDPM',N'白件A',N'个')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'SR-PD-1','2026-06-20','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量],[单价],[金额]) VALUES(N'SR-PD-1',N'PJ-PD',N'PDPM',N'白件A',N'黑',5,3,15)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-PD-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-PD-1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'SR-PD-1'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SR-PD-1'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PDPM'");
    }

    [SkippableFact]
    public async Task Detail_orders_with_receipt_columns_and_unfinished()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().PurchaseDetailAsync(null, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, null);
            var r = Assert.Single(rows.Where(x => x.订购单号 == "SJ-PD-1"));
            Assert.Equal(8m, r.订购数量);
            Assert.Equal(5m, r.入仓数量);
            Assert.Equal(3m, r.未完成数量);
            Assert.Equal(24m, r.订购金额);
            Assert.Equal(15m, r.入仓金额);
            Assert.Equal(9m, r.未完成金额);
            Assert.Equal("SR-PD-1", r.入仓单号);
            Assert.NotNull(r.入仓日期);
            Assert.Equal("未完成", r.完成情况);
            Assert.Equal("个", r.单位);
            Assert.Equal("PD测试加工厂", r.加工厂名称);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Detail_filters_完成情况_and_factory_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var unfinished = await Svc().PurchaseDetailAsync(null, null, null, null, "未完成");
            Assert.Contains(unfinished, x => x.订购单号 == "SJ-PD-1");
            var finished = await Svc().PurchaseDetailAsync(null, null, null, null, "已完成");
            Assert.DoesNotContain(finished, x => x.订购单号 == "SJ-PD-1");
            Assert.Contains(await Svc().PurchaseDetailAsync("PD测试", null, null, null, null), x => x.订购单号 == "SJ-PD-1");
            Assert.DoesNotContain(await Svc().PurchaseDetailAsync("不存在", null, null, null, null), x => x.订购单号 == "SJ-PD-1");
            Assert.Contains(await Svc().PurchaseDetailAsync(null, null, null, "PJ-PD", null), x => x.订购单号 == "SJ-PD-1");
        }
        finally { Clean(c); }
    }
}
