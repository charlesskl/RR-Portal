using Dapper;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReceivablesSettlementDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 逐单核销_账龄_待核销()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string cust = "AR_C1";
        const string mat = "AR_M1";
        const string 出货单号 = "AR_XS1";
        const string 收款单号 = "AR_XK1";
        const string 退货单号 = "AR_XR1";
        var d0 = new DateTime(2026, 4, 1);

        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@n", new { n = 出货单号 });
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@n", new { n = 出货单号 });
            c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@n", new { n = 收款单号 });
            c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@n", new { n = 收款单号 });
            c.Execute("DELETE FROM [销售退货明细单] WHERE [单号]=@n", new { n = 退货单号 });
            c.Execute("DELETE FROM [销售退货单] WHERE [单号]=@n", new { n = 退货单号 });
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@mat", new { mat });
        }
        Clean();
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(@cust,N'对账客户')", new { cust });
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(@mat,N'成品甲')", new { mat });
        try
        {
            // 出货 1000（审核），日期 d0
            c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[日期],[数量],[金额],[审核]) VALUES(@n,N'仓',@cust,N'对账客户',@d0,10,1000,'1')", new { n = 出货单号, cust, d0 });
            c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES(@n,N'仓',@cust,N'对账客户',@mat,N'成品甲',10,100,1000)", new { n = 出货单号, cust, mat });
            // 收款 400（审核），出仓单号=出货单号
            c.Execute("INSERT INTO [销售收款单]([单号],[出仓单号],[金额],[审核]) VALUES(@n,@s,400,'1')", new { n = 收款单号, s = 出货单号 });
            c.Execute("INSERT INTO [销售收款明细单]([单号],[出仓单号],[客户编号],[客户名称],[货款金额],[收款金额],[应收金额]) VALUES(@n,@s,@cust,N'对账客户',1000,400,600)", new { n = 收款单号, s = 出货单号, cust });
            // 退货 100（审核），销售单号=出货单号
            c.Execute("INSERT INTO [销售退货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(@n,N'仓',@cust,N'对账客户',1,100,'1')", new { n = 退货单号, cust });
            c.Execute("INSERT INTO [销售退货明细单]([单号],[仓库],[销售单号],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES(@n,N'仓',@s,@cust,N'对账客户',@mat,N'成品甲',1,100,100)", new { n = 退货单号, s = 出货单号, cust, mat });

            var svc = new ReceivablesService(Factory());

            // 逐单核销
            var settle = await svc.SettlementAsync(cust, false);
            var row = settle.Single(r => r.出货单号 == 出货单号);
            Assert.Equal(1000m, row.应收金额);
            Assert.Equal(100m, row.退货金额);
            Assert.Equal(400m, row.已收金额);
            Assert.Equal(500m, row.未核销余额); // 1000 - 100 - 400

            // 账龄：d0 + 45 天 → 落 31-60 桶
            var aging = await svc.AgingAsync(cust, d0.AddDays(45));
            var ar = aging.Single(r => r.客户编号 == cust);
            Assert.Equal(0m, ar.账龄0_30);
            Assert.Equal(500m, ar.账龄31_60);
            Assert.Equal(0m, ar.账龄61_90);
            Assert.Equal(0m, ar.账龄90以上);
            Assert.Equal(500m, ar.合计);

            // 待核销出货单
            var un = await svc.UnsettledShipmentsAsync(cust);
            var u = un.Single(r => r.出货单号 == 出货单号);
            Assert.Equal(500m, u.未核销余额);
        }
        finally { Clean(); }
    }
}
