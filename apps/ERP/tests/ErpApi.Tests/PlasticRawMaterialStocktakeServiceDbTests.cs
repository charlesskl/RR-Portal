using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticRawMaterialStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new NoOpAuditLogger());
    private PlasticRawMaterialStocktakeService SvcWithAudit() => new(Factory(), new DocumentNumberGenerator(), new AuditLogger());

    private sealed class NoOpAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null)
            => Task.CompletedTask;
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料盘点明细单] WHERE [原料编号] IN (N'YPD-PM',N'YPD-PM-NONE')");
        c.Execute("DELETE FROM [原料盘点单] WHERE [备注]=N'YPD测试盘点'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
        c.Execute("DELETE FROM [c操作记录] WHERE [表名]=N'原料盘点单' AND [操作员]=N'tester'");
    }
    private static void SeedMaterial(SqlConnection c, decimal 库存)
    {
        c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[库存]) VALUES(N'YPD-PM',N'盘点测试原料',N'kg',@库存)", new { 库存 });
    }

    private static PlasticRawMaterialStocktakeCreateDto MakeDto() => new()
    {
        电脑单号 = "PC-YPD",
        备注 = "YPD测试盘点",
        明细 =
        {
            new() { 原料编号 = "YPD-PM", 原料名称 = "盘点测试原料", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 系统数量 = 100, 盘点数量 = 90 },
        }
    };

    [SkippableFact]
    public async Task Create_computes_盈亏()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YPD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Single(d!.明细);
            Assert.Equal(100m, d.明细[0].系统数量);
            Assert.Equal(90m, d.明细[0].盘点数量);
            Assert.Equal(-10m, d.明细[0].盈亏数量);
            Assert.Equal("台湾", d.明细[0].产地);
        }
        finally { Clean(c); }
    }

    // 系统数量服务端复算(账面=塑胶原料资料.库存):DTO 传入值不可信(防篡改);主档不存在=0
    [SkippableFact]
    public async Task Create_recomputes_系统数量_from_master_ignoring_dto()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(new PlasticRawMaterialStocktakeCreateDto
            {
                电脑单号 = "PC-YPD",
                备注 = "YPD测试盘点",
                明细 =
                {
                    new() { 原料编号 = "YPD-PM", 原料名称 = "盘点测试原料", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 系统数量 = 777, 盘点数量 = 90 },
                    new() { 原料编号 = "YPD-PM-NONE", 原料名称 = "未建档原料", 单位 = "kg", 系统数量 = 555, 盘点数量 = 3 },
                }
            }, "tester");
            var d = await Svc().GetAsync(单号);
            Assert.Equal(2, d!.明细.Count);
            Assert.Equal(100m, d.明细[0].系统数量);   // 忽略 DTO 传入的 777
            Assert.Equal(-10m, d.明细[0].盈亏数量);
            Assert.Equal(0m, d.明细[1].系统数量);     // 主档不存在 → 0
            Assert.Equal(3m, d.明细[1].盈亏数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_calibrates_库存_to_盘点数量()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await Svc().ApproveAsync(单号, "tester"));
            var 库存 = c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
            Assert.Equal(90m, 库存);   // 审核把账面校准为盘点数
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
        }
        finally { Clean(c); }
    }

    // 反审核新口径(同物料盘点):按明细存的系统数量还原 塑胶原料资料.库存 + 写审计日志
    [SkippableFact]
    public async Task Unapprove_restores_库存_to_系统数量_and_writes_audit()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await SvcWithAudit().CreateAsync(MakeDto(), "tester");
            Assert.True(await SvcWithAudit().ApproveAsync(单号, "tester"));
            Assert.Equal(90m, c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'"));

            Assert.True(await SvcWithAudit().UnapproveAsync(单号, "tester"));
            var 库存 = c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
            Assert.Equal(100m, 库存);   // 反审核按明细系统数量还原账面
            var d = await Svc().GetAsync(单号);
            Assert.Equal("0", d!.单头!.审核);
            // 审计日志:原料盘点单/反审核/单号
            var auditCount = c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [c操作记录] WHERE [表名]=N'原料盘点单' AND [行为]=N'反审核' AND [操作员]=N'tester' AND [操作记录] LIKE @p",
                new { p = $"%{单号}%" });
            Assert.Equal(1, auditCount);

            // 重复反审核幂等:返回 false 且库存不变
            Assert.False(await SvcWithAudit().UnapproveAsync(单号, "tester"));
            Assert.Equal(100m, c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await Svc().ApproveAsync(单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
