using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReturnStockDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialInventoryService Svc() => new(Factory());

    // 采购入仓 100(已审核) − 采购退仓 20(已审核) = 80
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'PRT01',N'退仓料',N'规R',N'米',10)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PRTRK1',N'退仓库','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTRK1',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',100)");
        c.Execute("INSERT INTO [采购退仓单]([单号],[仓库],[审核]) VALUES(N'PRTTC1',N'退仓库','1')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTTC1',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',20)");
        // 未审核退仓 999 不计
        c.Execute("INSERT INTO [采购退仓单]([单号],[仓库],[审核]) VALUES(N'PRTTC9',N'退仓库','0')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTTC9',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'PRT01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PRTRK1'");
        c.Execute("DELETE FROM [采购退仓明细单] WHERE [物料编号]=N'PRT01'");
        c.Execute("DELETE FROM [采购退仓单] WHERE [单号] IN (N'PRTTC1',N'PRTTC9')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PRT01'");
    }

    [SkippableFact]
    public async Task PurchaseReturn_subtracts_stock_only_when_approved()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 入100 − 退20 = 80（未审核退仓 999 不计）
            Assert.Equal(80m, await Svc().StockOfAsync("PRT01", null));
            var rows = await Svc().ListAsync(仓库: "退仓库", keyword: "PRT01");
            var row = Assert.Single(rows);
            Assert.Equal(80m, row.库存数量);
        }
        finally { Cleanup(c); }
    }
}
