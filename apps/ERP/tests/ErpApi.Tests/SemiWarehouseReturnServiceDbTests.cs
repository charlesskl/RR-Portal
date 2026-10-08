using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiWarehouseReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService ReceiptSvc() => new(Factory(), new DocumentNumberGenerator());
    private SemiWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Approve_reduces_inventory_then_unapprove_restores_it()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        string? 入仓单号 = null;
        string? 退仓单号 = null;
        try
        {
            // 造库存：入仓 100(单价2)，审核，得库存 100
            入仓单号 = await ReceiptSvc().CreateAsync(new SemiReceiptCreateDto
            {
                仓库 = P5cTestData.仓库,
                生产单号 = P5cTestData.生产单号,
                款号 = P5cTestData.款号,
                供应商编号 = "",
                供应商名称 = "测试加工厂",
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

            var invBefore = await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库);
            Assert.Equal(100m, invBefore.Single(x => x.物料编号 == P5cTestData.物料编号).库存);

            // 自由选品退仓 30
            退仓单号 = await Svc().CreateAsync(new SemiWarehouseReturnCreateDto
            {
                入仓单号 = 入仓单号,
                仓库 = P5cTestData.仓库,
                明细 = [ new SemiWarehouseReturnLineInput { 配件编号 = P5cTestData.物料编号, 数量 = 30 } ]
            }, "tester");

            Assert.True(await Svc().SetApprovedAsync(退仓单号, "tester", true));
            var invAfterApprove = await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库);
            Assert.Equal(70m, invAfterApprove.Single(x => x.物料编号 == P5cTestData.物料编号).库存);

            Assert.True(await Svc().SetApprovedAsync(退仓单号, "tester", false));
            var invAfterUnapprove = await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库);
            Assert.Equal(100m, invAfterUnapprove.Single(x => x.物料编号 == P5cTestData.物料编号).库存);
        }
        finally
        {
            if (退仓单号 != null)
            {
                c.Execute("DELETE FROM [半成品退仓明细单] WHERE [单号]=@n", new { n = 退仓单号 });
                c.Execute("DELETE FROM [半成品退仓单] WHERE [单号]=@n", new { n = 退仓单号 });
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
