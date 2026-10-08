using Dapper;
using ErpApi.Features.Payables;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PayablesServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 供应商应付_入仓减付款()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string sup = "P6CS9";
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [采购付款明细单] WHERE [供应商编号]=@sup", new { sup });
            c.Execute("DELETE FROM [采购付款单] WHERE [单号] IN ('PVF1')");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN ('PVG1')");
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=@sup", new { sup });
        }
        Clean();
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(@sup,N'对账供应商')", new { sup });
        try
        {
            // 采购入仓 100（单头审核）
            c.Execute("INSERT INTO [采购入仓单]([单号],[供应商编号],[供应商名称],[金额],[审核]) VALUES('PVG1',@sup,N'对账供应商',100,'1')", new { sup });
            // 采购付款 30（单头审核 + 明细）
            c.Execute("INSERT INTO [采购付款单]([单号],[金额],[审核]) VALUES('PVF1',30,'1')");
            c.Execute("INSERT INTO [采购付款明细单]([单号],[供应商编号],[供应商名称],[付款金额]) VALUES('PVF1',@sup,N'对账供应商',30)", new { sup });

            var rows = await new PayablesService(Factory()).SupplierAsync(sup);
            Assert.Single(rows);
            Assert.Equal(100m, rows[0].入仓金额);
            Assert.Equal(30m, rows[0].付款金额);
            Assert.Equal(70m, rows[0].应付余额);  // 100 - 30
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task 加工厂应付_回收减付款()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string fac = "P6CF9";
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [发外加工付款明细单] WHERE [加工厂编号]=@fac", new { fac });
            c.Execute("DELETE FROM [发外加工付款单] WHERE [单号] IN ('FVF1')");
            c.Execute("DELETE FROM [发外回收明细单] WHERE [单号] IN ('RVH1')");
            c.Execute("DELETE FROM [发外回收单] WHERE [单号] IN ('RVH1')");
            c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=@fac", new { fac });
        }
        Clean();
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(@fac,N'对账加工厂')", new { fac });
        try
        {
            // 发外回收：明细自带审核列，但明细单号 FK 发外回收单 → 先插单头
            c.Execute("INSERT INTO [发外回收单]([单号],[加工厂编号],[加工厂名称],[审核]) VALUES('RVH1',@fac,N'对账加工厂','1')", new { fac });
            // 发外回收明细 80（明细审核'1'）；款号/生产单号 FK 可空，留 NULL
            c.Execute("INSERT INTO [发外回收明细单]([单号],[加工厂编号],[加工厂名称],[金额],[审核]) VALUES('RVH1',@fac,N'对账加工厂',80,'1')", new { fac });
            // 发外付款 20（单头审核 + 明细）
            c.Execute("INSERT INTO [发外加工付款单]([单号],[金额],[审核]) VALUES('FVF1',20,'1')");
            c.Execute("INSERT INTO [发外加工付款明细单]([单号],[加工厂编号],[加工厂名称],[付款金额]) VALUES('FVF1',@fac,N'对账加工厂',20)", new { fac });

            var rows = await new PayablesService(Factory()).FactoryAsync(fac);
            Assert.Single(rows);
            Assert.Equal(80m, rows[0].回收金额);
            Assert.Equal(20m, rows[0].付款金额);
            Assert.Equal(60m, rows[0].应付余额);  // 80 - 20
        }
        finally { Clean(); }
    }
}
