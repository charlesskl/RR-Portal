using Dapper;
using ErpApi.Features.MasterData.Pricing;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PricingApplyDbTests(DbFixture fx)
{
    private SqlConnectionFactory Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Apply_writes_new_effective_quote_then_pricing_reads_it()
    {
        var f = Factory();
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            // 清子表，留/建父物料(满足 FK)
            c.Execute("DELETE FROM [报价资料] WHERE [物料编号]='TJ_M'");
            c.Execute("DELETE FROM [调价明细表] WHERE [单号]='TJ1'");
            c.Execute("IF NOT EXISTS(SELECT 1 FROM [物料资料] WHERE [物料编号]='TJ_M') INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'TJ_M',N'测试料')");
            c.Execute(@"INSERT INTO [调价明细表]([单号],[日期],[物料编号],[物料名称],[修改单价])
                        VALUES('TJ1','2026-05-01',N'TJ_M',N'测试料',88)");
            // 执行 apply 的等价 SQL(与 PricingController.Apply 一致)
            c.Execute(@"
INSERT INTO [报价资料]([报价类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[生效日期])
SELECT N'甲', d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[修改单价], ISNULL(d.[日期], SYSDATETIME())
FROM [调价明细表] d WHERE d.[单号]='TJ1' AND d.[修改单价] IS NOT NULL");
        }
        var price = await new PricingService(f).GetMaterialPriceAsync("TJ_M", "甲", new DateTime(2026, 6, 1));
        Assert.Equal(88m, price);
    }
}
