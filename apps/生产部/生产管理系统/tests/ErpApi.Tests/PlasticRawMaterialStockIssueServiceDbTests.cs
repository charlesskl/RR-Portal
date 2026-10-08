using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialStockIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStockIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料出库明细单] WHERE [原料编号]=N'YCK-PM'");
        c.Execute("DELETE FROM [原料出库单] WHERE [生产车间]=N'YCK测试车间'");
    }

    private static PlasticRawMaterialStockIssueCreateDto MakeDto() => new()
    {
        生产车间 = "YCK测试车间",
        领料备注 = "生产领料",
        制单人 = "王五",
        电脑单号 = "PC-YCK",
        明细 =
        {
            new() { 啤机生产单号 = "PPJ001", 生产单号 = "SC-YCK-1", 开单日期 = new DateTime(2026, 7, 1), 啤机外发单号 = "WF001", 原料编号 = "YCK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 5 },
            new() { 啤机生产单号 = "PPJ001", 开单日期 = new DateTime(2026, 7, 1), 啤机外发单号 = "WF001", 原料编号 = "YCK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YCK", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal("YCK测试车间", d.单头!.生产车间);
            Assert.Equal("王五", d.单头!.制单人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("PPJ001", d.明细[0].啤机生产单号);
            Assert.Equal("SC-YCK-1", d.明细[0].生产单号);   // 联动生产制单
            Assert.Null(d.明细[1].生产单号);                  // 可空:不联动的行留空
            Assert.Equal("WF001", d.明细[0].啤机外发单号);
            Assert.Equal("YCK-PM", d.明细[0].原料编号);
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
            Assert.True(await engine.ApproveAsync("原料出库单", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料出库单] WHERE [单号]=@单号", new { 单号 });
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
            Assert.True(await engine.ApproveAsync("原料出库单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
