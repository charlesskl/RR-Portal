using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticScrap;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReturnScrapServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService WhReturnSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task WarehouseReturn_Create_Get_金额_Delete_with_STC_prefix()
    {
        using var c = fx.Open();
        var 单号 = await WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            明细 = [ new PlasticWarehouseReturnCreateLineDto { 物料编号 = "STCPM01", 物料名称 = "ABS粒", 单位 = "kg", 数量 = 4, 单价 = 7 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STC", 单号);
            var d = await WhReturnSvc().GetAsync(单号);
            Assert.Equal(4m, d!.单头!.数量);
            Assert.Equal(28m, d.单头!.金额);
            Assert.Equal("宏达塑料", d.单头!.供应商名称);
            Assert.Single(d.明细);
            Assert.True(await WhReturnSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task WarehouseReturn_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto { 仓库 = "", 明细 = [ new PlasticWarehouseReturnCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }

    private PlasticScrapService ScrapSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Scrap_Create_Get_金额_Delete_with_SBF_prefix()
    {
        using var c = fx.Open();
        var 单号 = await ScrapSvc().CreateAsync(new PlasticScrapCreateDto
        {
            报废部门 = "注塑车间", 报废人 = "王五", 仓库 = "塑胶仓",
            明细 = [ new PlasticScrapCreateLineDto { 物料编号 = "SBFPM01", 物料名称 = "PP粒", 单位 = "kg", 数量 = 5, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SBF", 单号);
            var d = await ScrapSvc().GetAsync(单号);
            Assert.Equal(5m, d!.单头!.数量);
            Assert.Equal(30m, d.单头!.金额);
            Assert.Equal("王五", d.单头!.报废人);
            Assert.Single(d.明细);
            Assert.True(await ScrapSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶报废明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶报废单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Scrap_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => ScrapSvc().CreateAsync(new PlasticScrapCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => ScrapSvc().CreateAsync(new PlasticScrapCreateDto { 仓库 = "", 明细 = [ new PlasticScrapCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
}
