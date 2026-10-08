using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessShortageServiceDbTests(DbFixture fx)
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
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-SH-1','2026-06-15',N'F-SH',N'SH测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-SH-1',N'PJ-SH',N'K-SH',N'GM-SH',N'SHPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位],[物料类别]) VALUES(N'SHPM',N'白件A',N'个',N'注塑')");
        c.Execute("INSERT INTO [塑胶共用物料表]([塑胶货号],[工模编号],[物料编号],[物料名称],[颜色],[共用原料编号]) VALUES(N'H-SH',N'GM-SH',N'SHPM',N'白件A',N'黑',N'CR-SH')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'SR-SH-1','2026-06-20','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量]) VALUES(N'SR-SH-1',N'PJ-SH',N'SHPM',N'白件A',N'黑',5)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-SH-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-SH-1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'SR-SH-1'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SR-SH-1'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'H-SH'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SHPM'");
    }

    [SkippableFact]
    public async Task Shortage_orders_minus_receipts_grouped_by_material()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().ShortageAsync(null, null, "SHPM", false);
            var r = Assert.Single(rows.Where(x => x.物料编号 == "SHPM"));
            Assert.Equal(3m, r.欠数);
            Assert.Equal(3m, r.单价);
            Assert.Equal(9m, r.金额);
            Assert.Equal("CR-SH", r.共用物料编号);
            Assert.Equal("GM-SH", r.模具编号);
            Assert.Equal("个", r.单位);
            Assert.Equal("注塑", r.物料类别);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Shortage_filters_category_approval_onlyOwed()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            Assert.Contains(await Svc().ShortageAsync("注塑", null, "SHPM", false), x => x.物料编号 == "SHPM");
            Assert.DoesNotContain(await Svc().ShortageAsync("不存在类别", null, "SHPM", false), x => x.物料编号 == "SHPM");
            Assert.Contains(await Svc().ShortageAsync(null, null, "SHPM", true), x => x.物料编号 == "SHPM");
            Assert.Contains(await Svc().ShortageAsync(null, "已审核", "SHPM", false), x => x.物料编号 == "SHPM");
            Assert.DoesNotContain(await Svc().ShortageAsync(null, "未审核", "SHPM", false), x => x.物料编号 == "SHPM");
        }
        finally { Clean(c); }
    }
}
