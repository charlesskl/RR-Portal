using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new PlasticInventoryService(Factory()));

    [SkippableFact]
    public async Task Basis_pulls_book_stock_from_inventory()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD01'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPD01',N'盘点仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRPD01',N'盘点仓',N'SPDPM01',N'ABS',N'规A',N'kg',100)");
        try
        {
            var basis = await Svc().BasisAsync("盘点仓");
            var row = Assert.Single(basis, b => b.物料编号 == "SPDPM01");
            Assert.Equal(100m, row.系统数量);
        }
        finally { c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD01'"); }
    }

    [SkippableFact]
    public async Task Create_computes_盈亏_SPD_prefix_guard_then_delete()
    {
        using var c = fx.Open();
        // 盘点仓账面 100：系统数量服务端按台账复算(口径同 BasisAsync),以此为准
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM02'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD02'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPD02',N'盘点仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRPD02',N'盘点仓',N'SPDPM02',N'PP',N'',N'kg',100)");
        var 单号 = await Svc().CreateAsync(new PlasticStocktakeCreateDto
        {
            仓库 = "盘点仓",
            明细 = [ new PlasticStocktakeLineDto { 物料编号 = "SPDPM02", 物料名称 = "PP", 单位 = "kg", 系统数量 = 100, 盘点数量 = 90 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SPD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal(100m, d!.明细[0].系统数量);
            Assert.Equal(90m, d.明细[0].盘点数量);
            Assert.Equal(-10m, d.明细[0].盈亏数量);
            c.Execute("UPDATE [塑胶盘点单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [塑胶盘点单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            单号 = null!;
        }
        finally
        {
            if (单号 != null) { c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶盘点单] WHERE [单号]=@n", new { n = 单号 }); }
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM02'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD02'");
        }
    }

    // 系统数量服务端复算:DTO 传入值不可信(防篡改),落库值=台账实时聚合;无台账行的物料系统数量=0
    [SkippableFact]
    public async Task Create_recomputes_系统数量_from_ledger_ignoring_dto()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM03'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD03'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPD03',N'盘点仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRPD03',N'盘点仓',N'SPDPM03',N'ABS',N'',N'kg',50)");
        string? 单号 = null;
        try
        {
            单号 = await Svc().CreateAsync(new PlasticStocktakeCreateDto
            {
                仓库 = "盘点仓",
                明细 =
                [
                    new PlasticStocktakeLineDto { 物料编号 = "SPDPM03", 物料名称 = "ABS", 单位 = "kg", 系统数量 = 9999, 盘点数量 = 60 },
                    new PlasticStocktakeLineDto { 物料编号 = "SPDPM04", 物料名称 = "无台账料", 单位 = "kg", 系统数量 = 8888, 盘点数量 = 5 },
                ]
            }, "tester");
            var d = await Svc().GetAsync(单号);
            Assert.Equal(2, d!.明细.Count);
            Assert.Equal(50m, d.明细[0].系统数量);    // 忽略 DTO 传入的 9999
            Assert.Equal(10m, d.明细[0].盈亏数量);
            Assert.Equal(0m, d.明细[1].系统数量);     // 无台账行 → 0
            Assert.Equal(5m, d.明细[1].盈亏数量);
        }
        finally
        {
            if (单号 != null) { c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶盘点单] WHERE [单号]=@n", new { n = 单号 }); }
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM03'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD03'");
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticStocktakeCreateDto { 仓库 = "盘点仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticStocktakeCreateDto { 仓库 = "", 明细 = [ new PlasticStocktakeLineDto { 物料编号 = "X", 系统数量 = 1, 盘点数量 = 1 } ] }, "tester"));
    }
}
