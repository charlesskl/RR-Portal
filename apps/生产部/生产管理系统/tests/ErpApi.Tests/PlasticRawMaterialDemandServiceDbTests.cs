using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialDemand;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialDemandServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialDemandService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [原料编号]=N'RMD-PM'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [生产车间]=N'RMD测试车间'");
    }

    private static PlasticRawMaterialDemandCreateDto MakeDto() => new()
    {
        啤机生产单号 = "PJ-RMD",
        制单人 = "张三",
        领料备注 = "生产领料",
        生产车间 = "RMD测试车间",
        明细 =
        {
            new() { 原料编号 = "RMD-PM", 原料名称 = "ABS粒", 每包重量 = 25, 单位 = "kg", 需求数量KG = 5, 需求数量包 = 1 },
            new() { 原料编号 = "RMD-PM", 原料名称 = "ABS粒", 每包重量 = 25, 单位 = "kg", 需求数量KG = 3, 需求数量包 = 1 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_kg_and_bags()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YLX", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量KG);
            Assert.Equal(2m, d.单头!.数量包);
            Assert.Equal("张三", d.单头!.制单人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("RMD-PM", d.明细[0].原料编号);
            Assert.Equal(5m, d.明细[0].需求数量KG);
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
            Assert.True(await engine.ApproveAsync("原料生产需求表", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料生产需求表] WHERE [单号]=@单号", new { 单号 });
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
            Assert.True(await engine.ApproveAsync("原料生产需求表", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
