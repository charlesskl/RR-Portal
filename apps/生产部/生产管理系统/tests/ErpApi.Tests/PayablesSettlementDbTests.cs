using Dapper;
using ErpApi.Features.Payables;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PayablesSettlementDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 供应商_逐单核销_账龄_待付()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string sup = "AP_S1";
        const string 入仓单号 = "AP_CG1";
        const string 付款单号 = "AP_CF1";
        var d0 = new DateTime(2026, 4, 1);

        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [采购付款明细单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [采购付款单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 入仓单号 });
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=@sup", new { sup });
        }
        Clean();
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(@sup,N'对账供应商')", new { sup });
        try
        {
            // 采购入仓 1000（单头审核，金额=应付，日期 d0）；款号/生产单号 FK 可空，留 NULL
            c.Execute("INSERT INTO [采购入仓单]([单号],[供应商编号],[供应商名称],[日期],[金额],[审核]) VALUES(@n,@sup,N'对账供应商',@d0,1000,'1')", new { n = 入仓单号, sup, d0 });
            // 采购付款 400（单头审核 + 明细，入仓单号关联）
            c.Execute("INSERT INTO [采购付款单]([单号],[金额],[审核]) VALUES(@n,400,'1')", new { n = 付款单号 });
            c.Execute("INSERT INTO [采购付款明细单]([单号],[入仓单号],[供应商编号],[供应商名称],[付款金额]) VALUES(@n,@s,@sup,N'对账供应商',400)", new { n = 付款单号, s = 入仓单号, sup });

            var svc = new PayablesService(Factory());

            // 逐单核销
            var settle = await svc.SupplierSettlementAsync(sup, false);
            var row = settle.Single(r => r.入仓单号 == 入仓单号);
            Assert.Equal(1000m, row.应付金额);
            Assert.Equal(400m, row.已付金额);
            Assert.Equal(600m, row.未付余额); // 1000 - 400

            // 账龄：d0 + 45 天 → 落 31-60 桶
            var aging = await svc.SupplierAgingAsync(sup, d0.AddDays(45));
            var ag = aging.Single(r => r.供应商编号 == sup);
            Assert.Equal(0m, ag.账龄0_30);
            Assert.Equal(600m, ag.账龄31_60);
            Assert.Equal(0m, ag.账龄61_90);
            Assert.Equal(0m, ag.账龄90以上);
            Assert.Equal(600m, ag.合计);

            // 待付入仓单
            var un = await svc.SupplierUnpaidAsync(sup);
            var u = un.Single(r => r.入仓单号 == 入仓单号);
            Assert.Equal(600m, u.未付余额);
        }
        finally { Clean(); }
    }

    [SkippableFact]
    public async Task 加工厂_逐单核销_账龄_待付()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string fac = "AP_F1";
        const string 发外单号 = "AP_FW1";
        const string 回收单号 = "AP_FH1";
        const string 付款单号 = "AP_FF1";
        var d0 = new DateTime(2026, 4, 1);

        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [发外加工付款明细单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [发外加工付款单] WHERE [单号]=@n", new { n = 付款单号 });
            c.Execute("DELETE FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 });
            c.Execute("DELETE FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 });
            c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=@fac", new { fac });
        }
        Clean();
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(@fac,N'对账加工厂')", new { fac });
        try
        {
            // 发外回收：明细单号 FK 发外回收单 → 先插单头
            c.Execute("INSERT INTO [发外回收单]([单号],[加工厂编号],[加工厂名称],[审核]) VALUES(@n,@fac,N'对账加工厂','1')", new { n = 回收单号, fac });
            // 发外回收明细 800（明细审核'1'，发外单号关联，日期 d0）；款号/生产单号 FK 可空，留 NULL
            c.Execute("INSERT INTO [发外回收明细单]([单号],[发外单号],[加工厂编号],[加工厂名称],[日期],[金额],[审核]) VALUES(@n,@fw,@fac,N'对账加工厂',@d0,800,'1')", new { n = 回收单号, fw = 发外单号, fac, d0 });
            // 发外付款 300（单头审核 + 明细，发外单号关联）
            c.Execute("INSERT INTO [发外加工付款单]([单号],[金额],[审核]) VALUES(@n,300,'1')", new { n = 付款单号 });
            c.Execute("INSERT INTO [发外加工付款明细单]([单号],[发外单号],[加工厂编号],[加工厂名称],[付款金额]) VALUES(@n,@fw,@fac,N'对账加工厂',300)", new { n = 付款单号, fw = 发外单号, fac });

            var svc = new PayablesService(Factory());

            // 逐单核销
            var settle = await svc.FactorySettlementAsync(fac, false);
            var row = settle.Single(r => r.发外单号 == 发外单号);
            Assert.Equal(800m, row.应付金额);
            Assert.Equal(300m, row.已付金额);
            Assert.Equal(500m, row.未付余额); // 800 - 300

            // 账龄：d0 + 10 天 → 落 0-30 桶
            var aging = await svc.FactoryAgingAsync(fac, d0.AddDays(10));
            var ag = aging.Single(r => r.加工厂编号 == fac);
            Assert.Equal(500m, ag.账龄0_30);
            Assert.Equal(0m, ag.账龄31_60);
            Assert.Equal(0m, ag.账龄61_90);
            Assert.Equal(0m, ag.账龄90以上);
            Assert.Equal(500m, ag.合计);

            // 待付发外单
            var un = await svc.FactoryUnpaidAsync(fac);
            var u = un.Single(r => r.发外单号 == 发外单号);
            Assert.Equal(500m, u.未付余额);
        }
        finally { Clean(); }
    }
}
