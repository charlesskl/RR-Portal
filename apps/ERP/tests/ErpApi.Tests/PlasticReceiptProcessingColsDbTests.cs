using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;
using ErpApi.Integrations.Paiji;

[Collection("db")]
public class PlasticReceiptProcessingColsDbTests(DbFixture fx)
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
    public async Task Create_then_Get_roundtrips_工模编号_and_订单单号()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        var dto = new PlasticReceiptCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "测试车间", 仓库 = "塑胶仓", 订单单号 = "ZCS-T1", 备注 = "smoke",
            明细 =
            [
                new PlasticReceiptCreateLineDto { 生产单号 = "PR-MO", 款号 = "K-PR", 工模编号 = "GM-PR",
                    物料编号 = "PRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-PR", 单位 = "kg", 数量 = 7, 单价 = 2 },
                new PlasticReceiptCreateLineDto { 生产单号 = "PR-MO", 款号 = "K-PR", 工模编号 = "GM-PR",
                    物料编号 = "PRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-PR", 订单单号 = "ZCS-LINE", 单位 = "kg", 数量 = 3, 单价 = 2 },
            ],
        };
        string 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal("ZCS-T1", d!.单头!.订单单号);
            Assert.Equal(2, d.明细.Count);
            Assert.All(d.明细, l => { Assert.Equal("GM-PR", l.工模编号); Assert.Equal("K-PR", l.款号); });
            // 明细1 订单单号缺省取头;明细2 显式 ZCS-LINE
            Assert.Equal("ZCS-T1", d.明细[0].订单单号);
            Assert.Equal("ZCS-LINE", d.明细[1].订单单号);
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
        }
    }
}
