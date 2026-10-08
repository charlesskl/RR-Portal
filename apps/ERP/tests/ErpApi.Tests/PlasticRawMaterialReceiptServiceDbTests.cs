using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [原料编号]=N'YRC-PM'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [供应商名称]=N'YRC测试供应商'");
    }

    private static PlasticRawMaterialReceiptCreateDto MakeDto() => new()
    {
        供应商编号 = "S01",
        供应商名称 = "YRC测试供应商",
        单价类型 = "格式HK$/Lb",
        明细 =
        {
            new() { 原料编号 = "YRC-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单价类型 = "含税", 单位 = "kg", 数量 = 5, 单价 = 3 },
            new() { 原料编号 = "YRC-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单价类型 = "含税", 单位 = "kg", 数量 = 3, 单价 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_and_amount()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YRC", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(24m, d.单头!.金额);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("YRC-PM", d.明细[0].原料编号);
            Assert.Equal("台湾", d.明细[0].产地);
            Assert.Equal(25m, d.明细[0].每包重量);
            Assert.Equal("含税", d.明细[0].单价类型);
            Assert.Equal(15m, d.明细[0].金额);
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
            Assert.True(await engine.ApproveAsync("原料入仓单", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料入仓单] WHERE [单号]=@单号", new { 单号 });
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
            Assert.True(await engine.ApproveAsync("原料入仓单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
