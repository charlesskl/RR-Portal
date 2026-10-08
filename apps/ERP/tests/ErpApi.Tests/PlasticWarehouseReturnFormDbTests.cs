using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWarehouseReturnFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-01", 入仓单号 = "SR-OLD-01", 电脑单号 = "PC-02",
            明细 =
            [
                new PlasticWarehouseReturnCreateLineDto
                {
                    生产单号 = "MO-002", 款号 = "K200", 物料编号 = "PWRM01", 物料名称 = "ABS粒",
                    规格 = "规A", 颜色 = "黑", 塑胶货号 = "H-9", 单位 = "kg", 数量 = 6, 单价 = 7
                }
            ]
        }, "tester");
        try
        {
            Assert.StartsWith("STC", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("CK-01", d!.单头!.出库单号);
            Assert.Equal("SR-OLD-01", d.单头!.入仓单号);
            Assert.Equal("PC-02", d.单头!.电脑单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-002", l.生产单号);
            Assert.Equal("K200", l.款号);
            Assert.Equal("H-9", l.塑胶货号);
            Assert.Equal(42m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
