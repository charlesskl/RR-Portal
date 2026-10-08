using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new InventorySummaryService(Factory()));

    [SkippableFact]
    public async Task Basis_snapshots_system_qty_then_create_computes_盈亏()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        // 先造库存：入仓70(审核'1')，单头+明细审核位都置'1'（FK 主从：先插单头再插明细）
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKBASE',N'P5成品仓','1')");
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(N'P5RKBASE',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',70,'1')");
        string? pd = null;
        try
        {
            var basis = await Svc().BasisAsync(P5TestData.仓库);
            Assert.Single(basis);
            Assert.Equal(70m, basis[0].系统数量);

            pd = await Svc().CreateAsync(new FinishedStocktakeCreateDto
            {
                仓库 = P5TestData.仓库,
                明细 = [ new FinishedStocktakeLineDto {
                    款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "M",
                    系统数量 = 70, 盘点数量 = 68 } ]
            }, "tester");
            Assert.StartsWith("CP", pd);
            Assert.Equal(-2m, c.ExecuteScalar<decimal>("SELECT [盈亏数量] FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }));

            // 审核盘点(单头+明细审核位)后，库存 = 70 + (-2) = 68
            c.Execute("UPDATE [成品盘点单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            c.Execute("UPDATE [成品盘点明细单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            var inv = await new InventorySummaryService(Factory()).FinishedGoodsAsync(P5TestData.仓库);
            Assert.Equal(68m, inv[0].库存);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKBASE'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKBASE'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_negative_盘点数量()
    {
        using var _ = fx.Open();   // 仅用于 DB 不可用时跳过
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new FinishedStocktakeCreateDto
        {
            仓库 = "成品仓",
            明细 = [ new FinishedStocktakeLineDto { 款号 = "X", 系统数量 = 0, 盘点数量 = -1 } ]
        }, "tester"));
    }

    // 系统数量服务端复算(口径同 BasisAsync:按 款号×色号×颜色×尺码 实时聚合):DTO 传入值不可信(防篡改)
    [SkippableFact]
    public async Task Create_recomputes_系统数量_from_ledger_ignoring_dto()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKBASE',N'P5成品仓','1')");
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(N'P5RKBASE',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',70,'1')");
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new FinishedStocktakeCreateDto
            {
                仓库 = P5TestData.仓库,
                明细 =
                [
                    new FinishedStocktakeLineDto { 款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "M", 系统数量 = 9999, 盘点数量 = 68 },
                    new FinishedStocktakeLineDto { 款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "L", 系统数量 = 8888, 盘点数量 = 3 },
                ]
            }, "tester");
            var d = await Svc().GetAsync(pd);
            Assert.Equal(2, d!.明细.Count);
            Assert.Equal(70m, d.明细[0].系统数量);    // 忽略 DTO 传入的 9999
            Assert.Equal(-2m, d.明细[0].盈亏数量);
            Assert.Equal(0m, d.明细[1].系统数量);     // 无库存行 → 0
            Assert.Equal(3m, d.明细[1].盈亏数量);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKBASE'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKBASE'");
            P5TestData.Cleanup(c);
        }
    }
}
