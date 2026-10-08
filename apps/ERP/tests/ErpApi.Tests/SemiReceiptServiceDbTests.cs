using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static SemiReceiptCreateDto Dto() => new()
    {
        仓库 = P5cTestData.仓库, 日期 = new DateTime(2026, 7, 16),
        订单单号 = "SO-P5C-001", 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
        供应商编号 = "", 供应商名称 = "测试加工厂",
        明细 =
        [
            new SemiReceiptLineDto { 订单单号 = "SO-P5C-001", 配件编号 = P5cTestData.物料编号, 客户 = "ZURU", 产品货号 = P5cTestData.款号, 产品名称 = "P5c产品", 产品装配名称 = "P5c半成品料A", 生产单号 = P5cTestData.生产单号, 单位 = "件", 数量 = 60, 单价 = 10, 备注 = "第一行" },
            new SemiReceiptLineDto { 订单单号 = "SO-P5C-001", 配件编号 = P5cTestData.物料编号, 客户 = "ZURU", 产品货号 = P5cTestData.款号, 产品名称 = "P5c产品", 产品装配名称 = "P5c半成品料B", 生产单号 = P5cTestData.生产单号, 单位 = "件", 数量 = 40, 单价 = 10 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("BCP", 单号);
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [半成品入仓明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            Assert.Equal("SO-P5C-001", c.ExecuteScalar<string>("SELECT [订单单号] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(new DateTime(2026, 7, 16), c.ExecuteScalar<DateTime>("SELECT [日期] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("ZURU", c.ExecuteScalar<string>("SELECT TOP (1) [客户] FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("P5c产品", c.ExecuteScalar<string>("SELECT TOP (1) [名称] FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
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
        P5cTestData.Seed(c);
        // 共享测试库可能留有其他用例的入仓单；本用例断言 Total=1 与"上一单=null"，先清表保证隔离
        c.Execute("DELETE FROM [半成品入仓明细单]");
        c.Execute("DELETE FROM [半成品入仓单]");
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            Assert.Equal("SO-P5C-001", detail.单头!.订单单号);
            Assert.Equal("测试加工厂", detail.单头.供应商名称);
            Assert.Equal("ZURU", detail.明细[0].客户);
            Assert.Equal(P5cTestData.款号, detail.明细[0].产品货号);
            Assert.Equal("P5c产品", detail.明细[0].产品名称);
            Assert.Equal("P5c半成品料A", detail.明细[0].产品装配名称);
            var updatedDto = Dto();
            updatedDto.备注 = "已更新";
            updatedDto.明细 = [updatedDto.明细[0]];
            Assert.True(await Svc().UpdateAsync(单号, updatedDto, "editor"));
            var updated = await Svc().GetAsync(单号);
            Assert.Equal("已更新", updated!.单头!.备注);
            Assert.Single(updated.明细);
            Assert.Null(await Svc().GetAdjacentAsync(单号, "previous"));
            c.Execute("UPDATE [半成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [半成品入仓单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("BR不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }
}
