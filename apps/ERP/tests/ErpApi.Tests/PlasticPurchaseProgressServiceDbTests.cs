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

// 塑胶进度表(ProgressAsync):采购订单明细 vs 已审核入仓(按 生产单号+物料编号+颜色),欠数=订购−入仓。
// 免款号总表/生产制单父行:ProgressAsync 不 JOIN 生产制单,塑胶表无 FK,生产单号仅为字符串匹配键。
[Collection("db")]
public class PlasticPurchaseProgressServiceDbTests(DbFixture fx)
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
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号]=N'PP_D1'");
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号]=N'PP_D1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号] IN (N'PPR1',N'PPR0')");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'PPR1',N'PPR0')");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PPPM'");
    }

    [SkippableFact]
    public async Task Progress_orders_vs_approved_receipts_owed()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        using var c = fx.Open();
        Clean(c);
        c.Execute("INSERT INTO [塑胶采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[数量],[审核]) VALUES(N'PP_D1','2026-06-10','2026-06-20',N'S01',N'供A',10,'1')");
        c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[颜色],[数量]) VALUES(N'PP_D1',N'PP-MO',N'K-PP',N'PPPM',N'ABS粒',N'GM-PP',N'黑',10)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PPPM',N'ABS粒',N'kg')");
        // 已审核入仓 4
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'PPR1','2026-06-12','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[颜色],[数量]) VALUES(N'PPR1',N'PP-MO',N'PPPM',N'黑',4)");
        // 未审核入仓 99(不应计入)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'PPR0','2026-06-12','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[颜色],[数量]) VALUES(N'PPR0',N'PP-MO',N'PPPM',N'黑',99)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var rows = await Svc().ProgressAsync(null, qi, qe, "PPPM", false);
            var r = Assert.Single(rows);
            Assert.Equal("PP_D1", r.采购单号);
            Assert.Equal(10m, r.订购数量);
            Assert.Equal(4m, r.入仓数量);     // 未审核 99 不计
            Assert.Equal(6m, r.欠数);
            Assert.Equal("kg", r.单位);
            Assert.Equal("供A", r.供应商名称);
            Assert.Equal("GM-PP", r.模具编号);

            // onlyOwed: 欠 6>0 仍在
            Assert.Single(await Svc().ProgressAsync(null, qi, qe, "PPPM", true));
            // 供应商过滤
            Assert.Single(await Svc().ProgressAsync("供A", qi, qe, "PPPM", false));
            Assert.Empty(await Svc().ProgressAsync("无此供应商", qi, qe, "PPPM", false));
            // keyword 无关 + 区间外
            Assert.Empty(await Svc().ProgressAsync(null, qi, qe, "ZZZ", false));
            Assert.Empty(await Svc().ProgressAsync(null, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "PPPM", false));
        }
        finally { Clean(c); }
    }
}
