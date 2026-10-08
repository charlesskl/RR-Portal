using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Orders;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static OrderCreateDto Dto() => new()
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        款号 = P2TestData.款号, 款式 = "P2测试款式",
        单价 = 100m, 仓库 = "成品仓", 交货日期 = new DateTime(2026, 7, 1),
        明细 =
        [
            new OrderLineDto { 色号 = "C1", 颜色 = "黑色", 尺码 = "S", 数量 = 10 },
            new OrderLineDto { 色号 = "C1", 颜色 = "黑色", 尺码 = "M", 数量 = 20 },
            new OrderLineDto { 色号 = "C2", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_three_layers_with_totals()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        Assert.StartsWith("DD", 单号);   // 前缀DD+yyyyMMdd+流水

        // 三层都写入，且汇总正确：数量 60，金额 6000
        Assert.Equal(60m, c.ExecuteScalar<decimal>(
            "SELECT [数量] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(6000m, c.ExecuteScalar<decimal>(
            "SELECT [金额] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(1, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(3, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }));
        // 明细行金额 = 行数量×单价
        Assert.Equal(3000m, c.ExecuteScalar<decimal>(
            "SELECT [金额] FROM [成品客户订单明细表] WHERE [单号]=@单号 AND [尺码]=N'L'", new { 单号 }));
        // 新单未审核
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto();
        dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task List_and_Get_return_created_order()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");

        var page = await Svc().ListAsync(1, 20, 单号);
        Assert.Equal(1, page.Total);
        Assert.Equal(单号, page.Items[0].单号);

        var detail = await Svc().GetAsync(单号);
        Assert.NotNull(detail);
        Assert.Equal(P2TestData.款号, detail!.总表!.款号);
        Assert.Equal(3, detail.明细.Count);

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Delete_unapproved_removes_three_layers_but_approved_throws()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");

        // 审核后删除应抛异常
        c.Execute("UPDATE [成品客户订货单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));

        // 反审核后可删，三层全清
        c.Execute("UPDATE [成品客户订货单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 });
        Assert.True(await Svc().DeleteAsync(单号));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }));

        // 删除不存在的单 → false
        Assert.False(await Svc().DeleteAsync("DD不存在"));

        P2TestData.Cleanup(c);
    }
}
