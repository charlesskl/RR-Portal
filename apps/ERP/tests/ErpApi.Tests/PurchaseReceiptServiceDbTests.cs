using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static PurchaseReceiptCreateDto Dto() => new()
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商",
        仓库 = P3TestData.仓库, 付款方式 = "月结",
        明细 =
        [
            new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10 },
            new MaterialDocLineDto { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5m },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_totals()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CG", 单号);
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(1100m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购入仓明细单] WHERE [单号]=@单号 AND [物料编号]=N'P3M01'", new { 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
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

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 单号);
            Assert.Equal(1, page.Total);
            Assert.Equal(单号, page.Items[0].单号);

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);

            c.Execute("UPDATE [采购入仓单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [采购入仓单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.False(await Svc().DeleteAsync("CG不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
