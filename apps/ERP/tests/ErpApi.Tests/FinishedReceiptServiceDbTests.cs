using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static FinishedReceiptCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 订单单号 = "P5订单",
        明细 =
        [
            new FinishedReceiptLineDto { 配件编号 = "BBAP5T01", 客户 = "P5客户", 产品货号 = P5TestData.款号, 产品名称 = "P5测试款式", 产品装配名称 = "P5测试款式", 生产单号 = P5TestData.生产单号, 箱数 = 6, 数量 = 60, 单价 = 10 },
            new FinishedReceiptLineDto { 配件编号 = "BBAP5T02", 客户 = "P5客户", 产品货号 = P5TestData.款号, 产品名称 = "P5测试款式2", 产品装配名称 = "P5测试款式2", 生产单号 = P5TestData.生产单号, 箱数 = 4, 数量 = 40, 单价 = 10 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CR", 单号);
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品入仓明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            c.Execute("UPDATE [成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [成品入仓单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("CR不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
