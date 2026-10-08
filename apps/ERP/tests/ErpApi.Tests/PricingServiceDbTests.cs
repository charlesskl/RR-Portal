using Dapper;
using ErpApi.Features.MasterData.Pricing;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PricingServiceDbTests(DbFixture fx)
{
    private PricingService Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new PricingService(new SqlConnectionFactory(cfg));
    }

    [SkippableFact]
    public async Task Picks_latest_effective_price_on_or_before_date()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [报价资料] WHERE [物料编号]='PR1'");
            // 报价资料.物料编号 -> 物料资料.物料编号 有外键，需先确保父行存在
            c.Execute(@"IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'PR1')
                        INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'PR1',N'取价测试物料')");
            c.Execute(@"INSERT INTO [报价资料]([报价类别],[物料编号],[单价],[生效日期])
                        VALUES(N'甲',N'PR1',10,'2026-01-01'),
                               (N'甲',N'PR1',12,'2026-03-01'),
                               (N'甲',N'PR1',99,'2026-12-01')");
        }
        var svc = Make();
        var price = await svc.GetMaterialPriceAsync("PR1", "甲", new DateTime(2026, 6, 1));
        Assert.Equal(12m, price);
    }

    [SkippableFact]
    public async Task Returns_null_when_no_quote()
    {
        var svc = Make();
        Assert.Null(await svc.GetMaterialPriceAsync("NOPE_XYZ", "甲", DateTime.Now));
    }
}
