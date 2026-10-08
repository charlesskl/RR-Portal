using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;
using ErpApi.Integrations.Paiji;

[Collection("db")]
public class PlasticReceiptSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator(),
        new PaijiPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PaijiPushService>.Instance));

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticReceiptCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-12", 入仓单号 = "SR-REF-12", 电脑单号 = "PC-12",
            明细 = [ new PlasticReceiptCreateLineDto { 生产单号 = "MO-R", 款号 = "K-R", 物料编号 = "PRCM01", 物料名称 = "ABS", 颜色 = "黑", 塑胶货号 = "H-R", 单位 = "kg", 数量 = 5, 单价 = 8 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SR", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("CK-12", d!.单头!.出库单号);
            Assert.Equal("SR-REF-12", d.单头!.入仓单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-R", l.生产单号);
            Assert.Equal("H-R", l.塑胶货号);
            Assert.Equal(40m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
