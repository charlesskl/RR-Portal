using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedIssueService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static FinishedIssueCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
        生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedIssueLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } ]
    };

    [SkippableFact]
    public async Task Create_then_delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CC", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [成品出仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品出仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("CC不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
