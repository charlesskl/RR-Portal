using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticScrap;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticScrapSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticScrapService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_supplier_header_and_new_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticScrapCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-11", 入仓单号 = "SR-OLD-11", 电脑单号 = "PC-11",
            明细 = [ new PlasticScrapCreateLineDto { 生产单号 = "MO-S", 款号 = "K-S", 物料编号 = "PSSM01", 物料名称 = "PP", 颜色 = "白", 塑胶货号 = "H-S", 单位 = "kg", 数量 = 4, 单价 = 5 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SBF", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("宏达塑料", d!.单头!.供应商名称);
            Assert.Equal("CK-11", d.单头!.出库单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-S", l.生产单号);
            Assert.Equal("H-S", l.塑胶货号);
            Assert.Equal(20m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶报废明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶报废单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
