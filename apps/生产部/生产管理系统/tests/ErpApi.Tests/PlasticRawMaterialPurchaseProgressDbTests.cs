using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialPurchaseProgressDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialPurchaseOrderService OrderSvc() => new(Factory(), new DocumentNumberGenerator());
    private PlasticRawMaterialReceiptService ReceiptSvc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [原料编号]=N'YPP-PM'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [供应商名称]=N'YPP测试供应商'");
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [原料编号]=N'YPP-PM'");
        c.Execute("DELETE FROM [原料采购订单] WHERE [供应商名称]=N'YPP测试供应商'");
    }

    [SkippableFact]
    public async Task Progress_aggregates_receipts_and_computes_owed_and_percent()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 订单号 = await OrderSvc().CreateAsync(new()
            {
                供应商编号 = "S01",
                供应商名称 = "YPP测试供应商",
                明细 =
                {
                    new() { 原料编号 = "YPP-PM", 原料名称 = "ABS粒", 规格 = "规X", 单位 = "kg", 单价类型 = "含税", 订货数量 = 10, 单价 = 3 },
                }
            }, "tester");

            var 入仓单号 = await ReceiptSvc().CreateAsync(new()
            {
                供应商编号 = "S01",
                供应商名称 = "YPP测试供应商",
                订单单号 = 订单号,
                明细 =
                {
                    new() { 原料编号 = "YPP-PM", 原料名称 = "ABS粒", 单位 = "kg", 数量 = 4, 单价 = 3 },
                }
            }, "tester");

            // 未审核入仓不计入进度
            var rows = await OrderSvc().ProgressAsync("YPP测试", null, null, null, false, null);
            var row = Assert.Single(rows.Where(r => r.采购单号 == 订单号));
            Assert.Equal(10m, row.订货数量);
            Assert.Equal(0m, row.入仓数量);
            Assert.Equal(10m, row.欠数);
            Assert.Equal(0m, row.进度);

            Assert.True(await engine.ApproveAsync("原料入仓单", 入仓单号, "tester"));
            rows = await OrderSvc().ProgressAsync("YPP测试", null, null, null, false, null);
            row = Assert.Single(rows.Where(r => r.采购单号 == 订单号));
            Assert.Equal(4m, row.入仓数量);
            Assert.Equal(6m, row.欠数);
            Assert.Equal(40m, row.进度);

            // onlyOwed 过滤:欠数>0 仍在;入仓满后消失
            rows = await OrderSvc().ProgressAsync("YPP测试", null, null, null, true, null);
            Assert.Single(rows.Where(r => r.采购单号 == 订单号));

            var 入仓单号2 = await ReceiptSvc().CreateAsync(new()
            {
                供应商编号 = "S01",
                供应商名称 = "YPP测试供应商",
                订单单号 = 订单号,
                明细 = { new() { 原料编号 = "YPP-PM", 原料名称 = "ABS粒", 单位 = "kg", 数量 = 6, 单价 = 3 } }
            }, "tester");
            Assert.True(await engine.ApproveAsync("原料入仓单", 入仓单号2, "tester"));
            rows = await OrderSvc().ProgressAsync("YPP测试", null, null, null, true, null);
            Assert.Empty(rows.Where(r => r.采购单号 == 订单号));
            rows = await OrderSvc().ProgressAsync("YPP测试", null, null, null, false, null);
            row = Assert.Single(rows.Where(r => r.采购单号 == 订单号));
            Assert.Equal(10m, row.入仓数量);
            Assert.Equal(0m, row.欠数);
            Assert.Equal(100m, row.进度);
        }
        finally { Clean(c); }
    }
}
