using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialStockReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialStockReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStockReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料退库明细单] WHERE [原料编号]=N'YTK-PM'");
        c.Execute("DELETE FROM [原料退库表] WHERE [部门]=N'YTK测试车间'");
    }

    private static PlasticRawMaterialStockReturnCreateDto MakeDto() => new()
    {
        部门 = "YTK测试车间",
        退料人 = "张三",
        电脑单号 = "PC-YTK",
        明细 =
        {
            new() { 啤机生产单号 = "PPJ001", 开单日期 = new DateTime(2026, 7, 1), 原料编号 = "YTK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 5 },
            new() { 啤机生产单号 = "PPJ001", 开单日期 = new DateTime(2026, 7, 1), 原料编号 = "YTK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YTK", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal("YTK测试车间", d.单头!.部门);
            Assert.Equal("张三", d.单头!.退料人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("PPJ001", d.明细[0].啤机生产单号);
            Assert.Equal("YTK-PM", d.明细[0].原料编号);
            Assert.Equal("台湾", d.明细[0].产地);
            Assert.Equal(25m, d.明细[0].每包重量);
            Assert.Equal(new DateTime(2026, 7, 1), d.明细[0].开单日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料退库表", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料退库表] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料退库表", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
