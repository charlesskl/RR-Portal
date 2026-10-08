using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.MaterialScrap;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialScrapServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialScrapService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static MaterialScrapCreateDto Dto() => new()
    {
        报废部门 = "车间一", 报废人 = "李四", 仓库 = P3TestData.仓库,
        明细 = [ new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 5, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_then_Get_then_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("BF", 单号);
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [报废单] WHERE [单号]=@单号", new { 单号 }));
            var detail = await Svc().GetAsync(单号);
            Assert.Single(detail!.明细);
            Assert.Equal("车间一", detail.单头!.报废部门);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [报废明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [报废明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [报废单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_persists_生产单号_款号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var dto = Dto();
        dto.明细[0].生产单号 = "MO-2026-001";
        dto.明细[0].款号 = "K123";
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var detail = await Svc().GetAsync(单号);
            var line = Assert.Single(detail!.明细);
            Assert.Equal("MO-2026-001", line.生产单号);
            Assert.Equal("K123", line.款号);
        }
        finally
        {
            c.Execute("DELETE FROM [报废明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [报废单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
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
    public async Task Create_rejects_blank_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.仓库 = null;
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }
}
