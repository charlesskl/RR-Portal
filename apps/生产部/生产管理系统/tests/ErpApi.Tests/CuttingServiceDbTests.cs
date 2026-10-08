using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Cutting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class CuttingServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private CuttingService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static CuttingCreateDto Dto() => new()
    {
        生产单号 = P4TestData.生产单号, 货号 = P4TestData.货号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
        客户编号 = P4TestData.客户编号, 客户名称 = "P4测试客户",
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂",
        床号 = "1", 布种 = "全棉",
        明细 =
        [
            new CuttingLineDto { 扎号 = 1, 缸号 = "G1", 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new CuttingLineDto { 扎号 = 2, 缸号 = "G1", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        var 裁床单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CB", 裁床单号);
            Assert.Equal(P4TestData.货号, c.ExecuteScalar<string>("SELECT [货号] FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.Equal(70m, c.ExecuteScalar<decimal>("SELECT [裁床数量] FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.Equal(40m, c.ExecuteScalar<decimal>("SELECT [计件数量] FROM [裁床明细表] WHERE [裁床单号]=@n AND [扎号]=1", new { n = 裁床单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
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
        P4TestData.Seed(c);
        var 裁床单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 裁床单号);
            Assert.Equal(1, page.Total);

            var detail = await Svc().GetAsync(裁床单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            Assert.Equal("1", detail.单头!.床号);
            Assert.Equal(P4TestData.货号, detail.单头!.货号);

            c.Execute("UPDATE [裁床总表] SET [审核]='1' WHERE [裁床单号]=@n", new { n = 裁床单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(裁床单号));
            c.Execute("UPDATE [裁床总表] SET [审核]='0' WHERE [裁床单号]=@n", new { n = 裁床单号 });
            Assert.True(await Svc().DeleteAsync(裁床单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.False(await Svc().DeleteAsync("CB不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
        }
    }
}
