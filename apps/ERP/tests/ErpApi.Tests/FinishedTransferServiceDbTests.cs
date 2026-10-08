using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedTransferServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedTransferService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static FinishedTransferCreateDto Dto() => new()
    {
        源仓库 = P5TestData.仓库, 目标仓库 = P5TestData.仓库2,
        生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedTransferLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_writes_源目标仓库_to_lines_and_moves_inventory()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        // A仓入仓100(主单+明细, 审核1) —— 明细单有主从FK到入仓单, 必须先插入仓单master
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BTRK',N'P5成品仓','1')");
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(N'P5BTRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CD", 单号);
            Assert.Equal("P5成品仓", c.ExecuteScalar<string>("SELECT [源仓库] FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("P5半成品仓", c.ExecuteScalar<string>("SELECT [目标仓库] FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 }));
            // 模拟控制器同步明细审核位后看库存
            c.Execute("UPDATE [成品调拨明细单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            var svc = new InventorySummaryService(Factory());
            Assert.Equal(70m, (await svc.FinishedGoodsAsync("P5成品仓"))[0].库存);
            Assert.Equal(30m, (await svc.FinishedGoodsAsync("P5半成品仓"))[0].库存);
        }
        finally
        {
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BTRK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BTRK'");
            P5TestData.Cleanup(c);
        }
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
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            c.Execute("UPDATE [成品调拨单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [成品调拨单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("CD不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
