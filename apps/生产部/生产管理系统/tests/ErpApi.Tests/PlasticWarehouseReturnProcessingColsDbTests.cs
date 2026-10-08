using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWarehouseReturnProcessingColsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_then_Get_roundtrips_工模编号_and_订单单号()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        var dto = new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "测试车间", 仓库 = "塑胶仓", 订单单号 = "ZCS-WR", 备注 = "smoke",
            明细 =
            [
                new PlasticWarehouseReturnCreateLineDto { 生产单号 = "WR-MO", 款号 = "K-WR", 工模编号 = "GM-WR",
                    物料编号 = "WRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-WR", 单位 = "kg", 数量 = 7, 单价 = 2 },
                new PlasticWarehouseReturnCreateLineDto { 生产单号 = "WR-MO", 款号 = "K-WR", 工模编号 = "GM-WR",
                    物料编号 = "WRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-WR", 订单单号 = "ZCS-LINE", 单位 = "kg", 数量 = 3, 单价 = 2 },
            ],
        };
        string 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal("ZCS-WR", d!.单头!.订单单号);
            Assert.Equal(2, d.明细.Count);
            Assert.All(d.明细, l => { Assert.Equal("GM-WR", l.工模编号); Assert.Equal("K-WR", l.款号); });
            Assert.Equal("ZCS-WR", d.明细[0].订单单号);     // 缺省取头
            Assert.Equal("ZCS-LINE", d.明细[1].订单单号);   // 显式
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@单号", new { 单号 });
        }
    }
}
