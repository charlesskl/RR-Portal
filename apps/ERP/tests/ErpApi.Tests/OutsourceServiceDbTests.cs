using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Outsourcing;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OutsourceServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OutsourceService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static OutsourceCreateDto Dto() => new()
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 =
        [
            new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 60 },
            new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "白色", 尺码 = "L", 数量 = 40 },
        ]
    };

    [SkippableFact]
    public async Task Create_takes_price_from_item_and_computes_total()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("FW", 单号);
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>("SELECT TOP 1 [单价] FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(150m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外加工明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(250m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_item_not_in_rate_table()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        try
        {
            var dto = Dto();
            dto.明细 = [ new OutsourceLineDto { 加工项目 = "不存在项目", 颜色 = "黑", 尺码 = "M", 数量 = 10 } ];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
        }
        finally { P4M7TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 单号);
            Assert.Equal(1, page.Total);

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);

            c.Execute("UPDATE [发外加工单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [发外加工单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("FW不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }
}
