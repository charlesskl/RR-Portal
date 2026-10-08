using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService ReceiptSvc() => new(Factory(), new DocumentNumberGenerator());
    private SemiIssueService Svc() => new(Factory(), new DocumentNumberGenerator());
    private async Task<decimal> Inv() =>
        (await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库))
            .Where(x => x.物料编号 == P5cTestData.物料编号).Sum(x => x.库存);

    [SkippableFact]
    public async Task Approve_reduces_semi_inventory_by_issued_quantity_then_unapprove_restores()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        string? 入仓单号 = null;
        string? 出库单号 = null;
        try
        {
            入仓单号 = await ReceiptSvc().CreateAsync(new SemiReceiptCreateDto
            {
                仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
                供应商编号 = "", 供应商名称 = "测试加工厂",
                明细 =
                [
                    new SemiReceiptLineDto
                    {
                        配件编号 = P5cTestData.物料编号, 客户 = "ZURU", 产品货号 = P5cTestData.款号,
                        产品名称 = "P5c产品", 产品装配名称 = "P5c半成品料A", 生产单号 = P5cTestData.生产单号,
                        单位 = "件", 数量 = 100, 单价 = 2
                    }
                ]
            }, "tester");
            c.Execute("UPDATE [半成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 入仓单号 });
            Assert.Equal(100m, await Inv());

            // 自由选产品出库 30
            出库单号 = await Svc().CreateAsync(new SemiIssueCreateDto
            {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 领料人 = "张三",
                明细 = [ new SemiIssueLineInput { 配件编号 = P5cTestData.物料编号, 数量 = 30 } ]
            }, "tester");

            // 审核（翻单头审核位，union 减库存）
            c.Execute("UPDATE [半成品领料单] SET [审核]='1' WHERE [单号]=@n", new { n = 出库单号 });
            Assert.Equal(70m, await Inv());

            // 反审核恢复
            c.Execute("UPDATE [半成品领料单] SET [审核]='0' WHERE [单号]=@n", new { n = 出库单号 });
            Assert.Equal(100m, await Inv());
        }
        finally
        {
            if (出库单号 != null)
            {
                c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = 出库单号 });
                c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = 出库单号 });
            }
            if (入仓单号 != null)
            {
                c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 入仓单号 });
                c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 入仓单号 });
            }
            P5cTestData.Cleanup(c);
        }
    }
}
