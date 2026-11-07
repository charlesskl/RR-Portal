using Dapper;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReceivablesServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 应收余额_出货减收款减退货()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var prefix = "T6" + Guid.NewGuid().ToString("N")[..8];
        var cust = prefix + "C";
        var material = prefix + "M";
        var shipment = prefix + "S";
        var returned = prefix + "R";
        var receipt = prefix + "P";
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [销售退货明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售退货单] WHERE [单号]=@returned", new { returned });
            c.Execute("DELETE FROM [销售收款明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@receipt", new { receipt });
            c.Execute("DELETE FROM [销售出货明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@shipment", new { shipment });
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@material", new { material });
        }
        try
        {
            c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(@cust,N'对账客户')", new { cust });
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=@material) INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(@material,N'成品乙')", new { material });
            // 出货 100（审核）
            c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(@shipment,N'仓',@cust,N'对账客户',10,100,'1')", new { cust, shipment });
            c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES(@shipment,N'仓',@cust,N'对账客户',@material,N'成品乙',10,10,100)", new { cust, material, shipment });
            // 退货 10（审核）
            c.Execute("INSERT INTO [销售退货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(@returned,N'仓',@cust,N'对账客户',1,10,'1')", new { cust, returned });
            c.Execute("INSERT INTO [销售退货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES(@returned,N'仓',@cust,N'对账客户',@material,N'成品乙',1,10,10)", new { cust, material, returned });
            // 收款 30（审核）
            c.Execute("INSERT INTO [销售收款单]([单号],[金额],[审核]) VALUES(@receipt,30,'1')", new { receipt });
            c.Execute("INSERT INTO [销售收款明细单]([单号],[客户编号],[客户名称],[收款金额]) VALUES(@receipt,@cust,N'对账客户',30)", new { cust, receipt });

            var rows = await new ReceivablesService(Factory()).ListAsync(cust);
            Assert.Single(rows);
            Assert.Equal(100m, rows[0].出货金额);
            Assert.Equal(30m, rows[0].收款金额);
            Assert.Equal(10m, rows[0].退货金额);
            Assert.Equal(60m, rows[0].应收余额);  // 100 - 30 - 10
        }
        finally { Clean(); }
    }
}
