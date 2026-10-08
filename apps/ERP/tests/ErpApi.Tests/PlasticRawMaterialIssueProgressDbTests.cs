using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialDemand;
using ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialIssueProgressDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialDemandService DemandSvc() => new(Factory(), new DocumentNumberGenerator());
    private PlasticRawMaterialStockIssueService IssueSvc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料出库明细单] WHERE [原料编号]=N'YIP-PM'");
        c.Execute("DELETE FROM [原料出库单] WHERE [制单人]=N'YIP测试'");
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [原料编号]=N'YIP-PM'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [制单人]=N'YIP测试'");
    }

    [SkippableFact]
    public async Task IssueProgress_aggregates_issues_by_remark_mo_material()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 需求单号 = await DemandSvc().CreateAsync(new()
            {
                啤机生产单号 = "YIP-MO-001",
                制单人 = "YIP测试",
                领料备注 = "生产领料",
                明细 =
                {
                    new() { 原料编号 = "YIP-PM", 原料名称 = "ABS粒", 单位 = "kg", 需求数量KG = 50, 需求数量包 = 10 },
                }
            }, "tester");

            var 出库单号 = await IssueSvc().CreateAsync(new()
            {
                生产车间 = "一车间",
                领料备注 = "生产领料",
                制单人 = "YIP测试",
                明细 =
                {
                    new() { 啤机生产单号 = "YIP-MO-001", 原料编号 = "YIP-PM", 原料名称 = "ABS粒", 单位 = "kg", 数量 = 4 },
                }
            }, "tester");

            // 未审核出库不计入进度
            var rows = await IssueSvc().IssueProgressAsync(null, null, "YIP-MO-001", null, null, false);
            var row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(10m, row.需求数量);
            Assert.Equal(0m, row.已出库数量);
            Assert.Equal(10m, row.欠数);
            Assert.Equal(0m, row.进度);

            Assert.True(await engine.ApproveAsync("原料出库单", 出库单号, "tester"));
            rows = await IssueSvc().IssueProgressAsync(null, null, "YIP-MO-001", null, null, false);
            row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(4m, row.已出库数量);
            Assert.Equal(6m, row.欠数);
            Assert.Equal(40m, row.进度);
            Assert.NotNull(row.最后出库日期);

            // 到货情况:未到=欠数>0 / 已到=欠数<=0
            rows = await IssueSvc().IssueProgressAsync(null, null, "YIP-MO-001", null, "未到", false);
            Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            rows = await IssueSvc().IssueProgressAsync(null, null, "YIP-MO-001", null, "已到", false);
            Assert.Empty(rows.Where(r => r.需求单号 == 需求单号));

            // 领料备注 不匹配(样品领料 vs 生产领料)不计入
            var 样品出库单号 = await IssueSvc().CreateAsync(new()
            {
                生产车间 = "一车间",
                领料备注 = "样品领料",
                制单人 = "YIP测试",
                明细 = { new() { 啤机生产单号 = "YIP-MO-001", 原料编号 = "YIP-PM", 原料名称 = "ABS粒", 单位 = "kg", 数量 = 2 } }
            }, "tester");
            Assert.True(await engine.ApproveAsync("原料出库单", 样品出库单号, "tester"));
            rows = await IssueSvc().IssueProgressAsync(null, null, "YIP-MO-001", null, null, false);
            row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(4m, row.已出库数量);
            Assert.Equal(6m, row.欠数);
        }
        finally { Clean(c); }
    }
}
