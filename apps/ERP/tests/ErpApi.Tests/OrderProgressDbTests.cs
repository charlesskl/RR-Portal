using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OrderProgressDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'OPSPROG',N'进度测试供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMPROG',N'进度测试料',N'规格X',N'米')");
        // 采购订单(已审核) + 2 行明细：同物料 OPMPROG 异色(红100/蓝50)
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POPROG1', SYSDATETIME(), N'OPSPROG', N'进度测试供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'POPROG1',SYSDATETIME(),N'OPMPROG',N'进度测试料',N'规格X',N'红',N'米',100),
                          (N'POPROG1',SYSDATETIME(),N'OPMPROG',N'进度测试料',N'规格X',N'蓝',N'米',50)");
        // 已审核入仓：红 30、蓝 50(满)
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'RKPROG1','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKPROG1',N'POPROG1',N'OPMPROG',N'红',30),
                          (N'RKPROG1',N'POPROG1',N'OPMPROG',N'蓝',50)");
        // 未审核入仓：红 999(不计)
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'RKPROG9','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKPROG9',N'POPROG1',N'OPMPROG',N'红',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'POPROG1'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKPROG1',N'RKPROG9')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPROG1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPROG1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMPROG'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'OPSPROG'");
    }

    [SkippableFact]
    public async Task Progress_computes_ordered_received_owed_only_approved_color_isolated()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false);
            Assert.Equal(2, rows.Count);
            var 红 = rows.Single(r => r.颜色 == "红");
            var 蓝 = rows.Single(r => r.颜色 == "蓝");
            // 红：订购100 入仓30(未审核999不计) 欠70；蓝：订购50 入仓50 欠0(颜色隔离，红入仓不串到蓝)
            Assert.Equal(100m, 红.订购数量);
            Assert.Equal(30m, 红.入仓数量);
            Assert.Equal(70m, 红.欠数);
            Assert.Equal(50m, 蓝.订购数量);
            Assert.Equal(50m, 蓝.入仓数量);
            Assert.Equal(0m, 蓝.欠数);
            Assert.Equal("POPROG1", 红.采购单号);
            Assert.Equal("进度测试供应商", 红.供应商名称);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Progress_onlyOwed_filters_fully_received()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var owed = await Svc().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "OPMPROG", onlyOwed: true);
            // 蓝 欠0 被过滤，只剩 红
            var row = Assert.Single(owed);
            Assert.Equal("红", row.颜色);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Progress_filters_by_supplier()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            Assert.Empty(await Svc().ProgressAsync(供应商: "不存在供应商", 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false));
            Assert.Equal(2, (await Svc().ProgressAsync(供应商: "OPSPROG", 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false)).Count);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Progress_matches_null_color_to_null_color()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'POPNULL'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'RKPNULL'");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPNULL'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPNULL'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMNULL'");
        try
        {
            c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMNULL',N'空色料',N'规格Y',N'米')");
            c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POPNULL',SYSDATETIME(),N'空色供应商','1')");
            // 明细：颜色 NULL，订购 80
            c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[单位],[数量]) VALUES(N'POPNULL',SYSDATETIME(),N'OPMNULL',N'空色料',N'米',80)");
            // 已审核入仓：颜色 NULL，入仓 50 → 应匹配上(ISNULL 兜空)
            c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'RKPNULL','1')");
            c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[数量]) VALUES(N'RKPNULL',N'POPNULL',N'OPMNULL',50)");

            var row = Assert.Single(await Svc().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "OPMNULL", onlyOwed: false));
            Assert.Equal(80m, row.订购数量);
            Assert.Equal(50m, row.入仓数量);   // NULL↔NULL 颜色匹配成功
            Assert.Equal(30m, row.欠数);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'POPNULL'");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'RKPNULL'");
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPNULL'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPNULL'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMNULL'");
        }
    }

    [SkippableFact]
    public async Task Progress_filters_by_order_date_range()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'POPD1',N'POPD2')");
        c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'POPD1',N'POPD2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMDATE'");
        try
        {
            c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMDATE',N'区间料',N'规格Z',N'米')");
            // 两张订单：日期 2026-03-10 与 2026-03-20
            c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POPD1','2026-03-10',N'区间供应商','1')");
            c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POPD2','2026-03-20',N'区间供应商','1')");
            c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[单位],[数量]) VALUES(N'POPD1','2026-03-10',N'OPMDATE',N'区间料',N'米',10)");
            c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[单位],[数量]) VALUES(N'POPD2','2026-03-20',N'OPMDATE',N'区间料',N'米',20)");

            // 区间 [03-10, 03-15]：半开上界=03-16，应只含 POPD1(03-10)
            var inRange = await Svc().ProgressAsync(供应商: null, 起: new DateTime(2026,3,10), 止: new DateTime(2026,3,15), keyword: "OPMDATE", onlyOwed: false);
            var only = Assert.Single(inRange);
            Assert.Equal("POPD1", only.采购单号);
            // 含 03-20 当天(止=03-20 → 半开上界 03-21)：两张都在
            var both = await Svc().ProgressAsync(供应商: null, 起: new DateTime(2026,3,10), 止: new DateTime(2026,3,20), keyword: "OPMDATE", onlyOwed: false);
            Assert.Equal(2, both.Count);
        }
        finally
        {
            c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'POPD1',N'POPD2')");
            c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'POPD1',N'POPD2')");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMDATE'");
        }
    }
}
