using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessIssueProgressServiceDbTests(DbFixture fx)
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
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-IP-1','2026-06-15',N'F-IP',N'IP测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-IP-1',N'PJ-IP',N'K-IP',N'GM-IP',N'IPPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'IPPM',N'白件A',N'个')");
        c.Execute("INSERT INTO [白件领料单]([单号],[日期],[审核]) VALUES(N'BJL-IP-1','2026-06-20','1')");
        c.Execute("INSERT INTO [白件领料明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量]) VALUES(N'BJL-IP-1',N'PJ-IP',N'IPPM',N'白件A',N'黑',5)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-IP-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-IP-1'");
        c.Execute("DELETE FROM [白件领料明细单] WHERE [单号]=N'BJL-IP-1'");
        c.Execute("DELETE FROM [白件领料单] WHERE [单号]=N'BJL-IP-1'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'IPPM'");
    }

    [SkippableFact]
    public async Task IssueProgress_orders_minus_issues()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().IssueProgressAsync(null, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, null);
            var r = Assert.Single(rows.Where(x => x.订购单号 == "SJ-IP-1"));
            Assert.Equal(8m, r.订购数量);
            Assert.Equal(5m, r.领料数量);
            Assert.Equal(3m, r.未完成数量);
            Assert.Equal(9m, r.未完成金额);
            Assert.Equal("BJL-IP-1", r.领料单号);
            Assert.NotNull(r.领料日期);
            Assert.Equal("未完成", r.完成情况);
            Assert.Equal("个", r.单位);
            Assert.Equal("IP测试加工厂", r.加工厂名称);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task IssueProgress_filters_完成情况_and_factory_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var unfinished = await Svc().IssueProgressAsync(null, null, null, null, "未完成");
            Assert.Contains(unfinished, x => x.订购单号 == "SJ-IP-1");
            var finished = await Svc().IssueProgressAsync(null, null, null, null, "已完成");
            Assert.DoesNotContain(finished, x => x.订购单号 == "SJ-IP-1");
            Assert.Contains(await Svc().IssueProgressAsync("IP测试", null, null, null, null), x => x.订购单号 == "SJ-IP-1");
            Assert.DoesNotContain(await Svc().IssueProgressAsync("不存在", null, null, null, null), x => x.订购单号 == "SJ-IP-1");
            Assert.Contains(await Svc().IssueProgressAsync(null, null, null, "PJ-IP", null), x => x.订购单号 == "SJ-IP-1");
        }
        finally { Clean(c); }
    }
}
