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
public class PlasticRawMaterialIssueProgressDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStockIssueService IssueSvc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c, string prefix)
    {
        Assert.Equal("erp_test", c.Database);
        var numbers = c.Query<string>("SELECT [单号] FROM [原料出库单] WHERE [制单人]=@prefix", new { prefix }).ToArray();
        if (numbers.Length > 0)
        {
            c.Execute("DELETE FROM [原料出库明细单] WHERE [单号] IN @numbers; DELETE FROM [原料出库单] WHERE [单号] IN @numbers; DELETE FROM [消息] WHERE [单号] IN @numbers", new { numbers });
            foreach (var number in numbers)
                c.Execute("DELETE FROM [c操作记录] WHERE [表名]=N'原料出库单' AND [操作记录]=@record", new { record = "单号=" + number });
        }
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=@demand; DELETE FROM [原料生产需求表] WHERE [单号]=@demand; DELETE FROM [原料自动扣料期初] WHERE [原料编号]=@raw; DELETE FROM [塑胶原料资料] WHERE [物料编号]=@raw", new { demand = prefix + "D", raw = prefix + "R" });
    }

    [SkippableFact]
    public async Task IssueProgress_aggregates_issues_by_remark_mo_material()
    {
        using var c = fx.Open();
        using var identity = new CloudRawFixture(c, fx.ConnectionString!);
        var prefix = "P113I" + Guid.NewGuid().ToString("N")[..8];
        var raw = prefix + "R";
        var mo = prefix + "MO";
        c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[每包重量],[库存]) VALUES(@raw,N'原料出库测试档',N'KG',25,100)", new { raw });
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            // 历史手工YLX的既有显示口径保留；新业务不再通过需求表POST造需求。
            var 需求单号 = prefix + "D";
            c.Execute(@"INSERT INTO [原料生产需求表]([单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[审核])
VALUES(@number,@mo,GETDATE(),@prefix,N'生产领料',N'0');
INSERT INTO [原料生产需求明细单]([单号],[原料编号],[原料名称],[单位],[需求数量KG],[需求数量包])
VALUES(@number,@raw,N'ABS粒',N'kg',50,10)", new { number = 需求单号, mo, prefix, raw });

            var 出库单号 = await IssueSvc().CreateAsync(new()
            {
                生产车间 = "一车间",
                领料备注 = "生产领料",
                制单人 = prefix,
                明细 =
                {
                    new() { 啤机生产单号 = mo, 原料编号 = raw, 原料名称 = "ABS粒", 单位 = "kg", 数量 = 4 },
                }
            }, identity.Clerk);

            // 未审核出库不计入进度
            var rows = await IssueSvc().IssueProgressAsync(null, null, mo, null, null, false);
            var row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(10m, row.需求数量);
            Assert.Equal(0m, row.已出库数量);
            Assert.Equal(10m, row.欠数);
            Assert.Equal(0m, row.进度);

            c.Execute("UPDATE [原料出库单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@number", new { number = 出库单号 });
            Assert.True(await engine.ApproveAsync("原料出库单", 出库单号, identity.Keeper));
            rows = await IssueSvc().IssueProgressAsync(null, null, mo, null, null, false);
            row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(4m, row.已出库数量);
            Assert.Equal(6m, row.欠数);
            Assert.Equal(40m, row.进度);
            Assert.NotNull(row.最后出库日期);

            // 到货情况:未到=欠数>0 / 已到=欠数<=0
            rows = await IssueSvc().IssueProgressAsync(null, null, mo, null, "未到", false);
            Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            rows = await IssueSvc().IssueProgressAsync(null, null, mo, null, "已到", false);
            Assert.Empty(rows.Where(r => r.需求单号 == 需求单号));

            // 领料备注 不匹配(样品领料 vs 生产领料)不计入
            var 样品出库单号 = await IssueSvc().CreateAsync(new()
            {
                生产车间 = "一车间",
                领料备注 = "样品领料",
                制单人 = prefix,
                明细 = { new() { 啤机生产单号 = mo, 原料编号 = raw, 原料名称 = "ABS粒", 单位 = "kg", 数量 = 2 } }
            }, identity.Clerk);
            c.Execute("UPDATE [原料出库单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@number", new { number = 样品出库单号 });
            Assert.True(await engine.ApproveAsync("原料出库单", 样品出库单号, identity.Keeper));
            rows = await IssueSvc().IssueProgressAsync(null, null, mo, null, null, false);
            row = Assert.Single(rows.Where(r => r.需求单号 == 需求单号));
            Assert.Equal(4m, row.已出库数量);
            Assert.Equal(6m, row.欠数);
        }
        finally { Clean(c, prefix); }
    }
}
