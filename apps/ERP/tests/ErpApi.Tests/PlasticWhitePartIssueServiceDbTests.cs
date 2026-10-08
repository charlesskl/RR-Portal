using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticWhitePartIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWhitePartIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWhitePartIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("IF NOT EXISTS(SELECT 1 FROM [款号总表] WHERE [款号]=N'K-BJ') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K-BJ',N'白件领料测试款')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[日期],[计划数量]) VALUES(N'BJ-MO',N'K-BJ','2026-06-29',100)");
        c.Execute("INSERT INTO [生产制单货号]([生产单号],[货号]) VALUES(N'BJ-MO',N'H-BJ')");
        c.Execute("INSERT INTO [塑胶共用物料表]([塑胶货号],[工模编号],[物料编号],[物料名称],[颜色],[用料名称],[加工内容],[加工单价]) VALUES(N'H-BJ',N'GM-BJ',N'BJPM',N'白件A',N'白',N'用A',N'喷油',3)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'BJPM',N'白件A',N'个')");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [白件领料明细单] WHERE [物料编号]=N'BJPM'");
        c.Execute("DELETE FROM [白件领料单] WHERE [领料部门]=N'BJ测试部门'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'H-BJ'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'BJPM'");
        c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=N'BJ-MO'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'BJ-MO'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-BJ'");
    }

    private static PlasticWhitePartIssueCreateDto MakeDto() => new()
    {
        领料部门 = "BJ测试部门",
        领料人 = "张三",
        领料备注 = "生产领料",
        明细 =
        {
            new() { 发外采购 = "采购", 生产单号 = "BJ-MO", 款号 = "K-BJ", 模具编号 = "GM-BJ", 物料编号 = "BJPM", 物料名称 = "白件A", 颜色 = "白", 用料名称 = "用A", 单位 = "个", 数量 = 5 },
            new() { 发外采购 = "采购", 生产单号 = "BJ-MO", 款号 = "K-BJ", 模具编号 = "GM-BJ", 物料编号 = "BJPM", 物料名称 = "白件A", 颜色 = "白", 用料名称 = "用A", 单位 = "个", 数量 = 3 },
        }
    };

    [SkippableFact]
    public async Task Basis_brings_bom_then_Create_then_Get()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var basis = await Svc().BasisAsync("BJ-MO");
            var b = Assert.Single(basis);
            Assert.Equal("GM-BJ", b.模具编号);
            Assert.Equal("白件A", b.物料名称);
            Assert.Equal("K-BJ", b.款号);
            Assert.Equal("个", b.单位);

            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("BJL", 单号);

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal("张三", d.单头!.领料人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("BJPM", d.明细[0].物料编号);
            Assert.Equal("GM-BJ", d.明细[0].模具编号);
            Assert.Equal(5m, d.明细[0].数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("白件领料单", 单号, "tester"));

            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [白件领料单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("白件领料单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
