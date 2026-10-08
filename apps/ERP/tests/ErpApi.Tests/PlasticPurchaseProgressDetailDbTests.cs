using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Integrations.Paiji;
using ErpApi.Integrations.SprayPlan;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 塑胶进度明细表(ProgressDetailAsync):进度表明细行 + 最近入仓单号/日期 + 完成情况(欠数>0=未完成)。
[Collection("db")]
public class PlasticPurchaseProgressDetailDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(),
        new PaijiPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PaijiPushService>.Instance),
        new SprayPlanPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new SprayPlanOptions()),
            Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<SprayPlanPushService>.Instance),
        new PlasticInventoryService(Factory()));

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号]=N'PPD_D1'");
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号]=N'PPD_D1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号] IN (N'PPD_R1',N'PPD_R2')");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'PPD_R1',N'PPD_R2')");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PPDM01'");
    }

    [SkippableFact]
    public async Task ProgressDetail_adds_receipt_doc_and_done_flag()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        using var c = fx.Open();
        Clean(c);
        c.Execute("INSERT INTO [塑胶采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[数量],[审核]) VALUES(N'PPD_D1','2026-06-10','2026-06-20',N'S01',N'供A',10,'1')");
        c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[颜色],[数量]) VALUES(N'PPD_D1',N'PPD-MO',N'K-PPD',N'PPDM01',N'ABS粒',N'GM-PPD',N'黑',10)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PPDM01',N'ABS粒',N'kg')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'PPD_R1','2026-06-12','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[颜色],[数量]) VALUES(N'PPD_R1',N'PPD-MO',N'PPDM01',N'黑',4)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            // 入仓 4:欠 6,未完成,入仓单号/日期=PPD_R1
            var r = Assert.Single(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", null));
            Assert.Equal("PPD_D1", r.采购单号);
            Assert.Equal(10m, r.订购数量);
            Assert.Equal(4m, r.入仓数量);
            Assert.Equal(6m, r.欠数);
            Assert.Equal("未完成", r.完成情况);
            Assert.Equal("PPD_R1", r.入仓单号);
            Assert.Equal(new DateTime(2026, 6, 12), r.入仓日期);
            Assert.Single(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", "未完成"));
            Assert.Empty(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", "已完成"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task ProgressDetail_completed_after_full_receipt()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        using var c = fx.Open();
        Clean(c);
        c.Execute("INSERT INTO [塑胶采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[数量],[审核]) VALUES(N'PPD_D1','2026-06-10','2026-06-20',N'S01',N'供A',10,'1')");
        c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[颜色],[数量]) VALUES(N'PPD_D1',N'PPD-MO',N'K-PPD',N'PPDM01',N'ABS粒',N'GM-PPD',N'黑',10)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PPDM01',N'ABS粒',N'kg')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'PPD_R1','2026-06-12','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[颜色],[数量]) VALUES(N'PPD_R1',N'PPD-MO',N'PPDM01',N'黑',4)");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'PPD_R2','2026-06-15','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[颜色],[数量]) VALUES(N'PPD_R2',N'PPD-MO',N'PPDM01',N'黑',6)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var r = Assert.Single(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", null));
            Assert.Equal(10m, r.入仓数量);
            Assert.Equal(0m, r.欠数);
            Assert.Equal("已完成", r.完成情况);
            Assert.Equal("PPD_R2", r.入仓单号);   // MAX(单号)
            Assert.Equal(new DateTime(2026, 6, 15), r.入仓日期);
            Assert.Single(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", "已完成"));
            Assert.Empty(await Svc().ProgressDetailAsync(null, qi, qe, "PPDM01", "未完成"));
        }
        finally { Clean(c); }
    }
}
