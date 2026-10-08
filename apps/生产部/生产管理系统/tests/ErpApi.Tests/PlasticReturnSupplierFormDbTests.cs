using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReturnSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_supplier_header_and_new_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-10", 入仓单号 = "SR-OLD-10", 电脑单号 = "PC-10",
            明细 = [ new PlasticReturnCreateLineDto { 生产单号 = "MO-T", 款号 = "K-T", 物料编号 = "PRSM01", 物料名称 = "PP", 颜色 = "白", 塑胶货号 = "H-T", 单位 = "kg", 数量 = 3, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STL", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("宏达塑料", d!.单头!.供应商名称);
            Assert.Equal("CK-10", d.单头!.出库单号);
            Assert.Equal("SR-OLD-10", d.单头!.入仓单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-T", l.生产单号);
            Assert.Equal("H-T", l.塑胶货号);
            Assert.Equal(18m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶退料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退料单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
