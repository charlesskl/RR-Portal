using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ProgressDetailDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    // 订单 PDORD1：物料 PDMA(有2次已审核入仓+1次未审核) / 物料 PDMB(零入仓)
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'PDSUP',N'明细测试供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'PDMA',N'明细料A',N'规A',N'米'),(N'PDMB',N'明细料B',N'规B',N'个')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'PDORD1', SYSDATETIME(), N'PDSUP', N'明细测试供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'PDORD1',SYSDATETIME(),N'PDMA',N'明细料A',N'规A',N'红',N'米',100),
                          (N'PDORD1',SYSDATETIME(),N'PDMB',N'明细料B',N'规B',N'红',N'个',50)");
        // 物料A 两次已审核入仓：RKA1(30,日期03-10)、RKA2(20,日期03-12)
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'RKA1','2026-03-10','1'),(N'RKA2','2026-03-12','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKA1',N'PDORD1',N'PDMA',N'红',30),
                          (N'RKA2',N'PDORD1',N'PDMA',N'红',20)");
        // 物料A 一次未审核入仓 RKA9(999) → 不计
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'RKA9','2026-03-13','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKA9',N'PDORD1',N'PDMA',N'红',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDORD1'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKA1',N'RKA2',N'RKA9')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDORD1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDORD1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'PDMA',N'PDMB')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDSUP'");
    }

    [SkippableFact]
    public async Task Detail_expands_each_receipt_and_keeps_unreceived_line()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "全部");
            // 物料A 2 条入仓行 + 物料B 1 条未入仓行 = 3 行（未审核 999 不计）
            Assert.Equal(3, rows.Count);
            var aRows = rows.Where(r => r.物料编号 == "PDMA").ToList();
            Assert.Equal(2, aRows.Count);
            Assert.All(aRows, r => Assert.Equal(100m, r.订购数量));
            Assert.Contains(aRows, r => r.入仓单号 == "RKA1" && r.入仓数量 == 30m);
            Assert.Contains(aRows, r => r.入仓单号 == "RKA2" && r.入仓数量 == 20m);
            Assert.DoesNotContain(aRows, r => r.入仓数量 == 999m);

            var bRow = Assert.Single(rows.Where(r => r.物料编号 == "PDMB"));
            Assert.Null(bRow.入仓单号);
            Assert.Null(bRow.入仓数量);
            Assert.Equal(50m, bRow.订购数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Detail_状态_filters_received_and_unreceived()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var received = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "已入仓");
            Assert.Equal(2, received.Count);
            Assert.All(received, r => Assert.NotNull(r.入仓单号));

            var unreceived = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "未入仓");
            var only = Assert.Single(unreceived);
            Assert.Equal("PDMB", only.物料编号);
            Assert.Null(only.入仓单号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Detail_matches_null_color_receipt_to_null_color_line()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDNUL1'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'RKNUL1'");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDNUL1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDNUL1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDNULM'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDNULS'");
        try
        {
            c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'PDNULS',N'空色明细供应商')");
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PDNULM',N'空色明细料',N'米')");
            c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[审核])
                        VALUES(N'PDNUL1',SYSDATETIME(),N'PDNULS',N'空色明细供应商','1')");
            // 订单明细颜色 NULL，订购 60
            c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[单位],[数量])
                        VALUES(N'PDNUL1',SYSDATETIME(),N'PDNULM',N'空色明细料',N'米',60)");
            // 已审核入仓颜色 NULL，入仓 25 → 应匹配上(ISNULL 兜空)
            c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'RKNUL1','2026-03-10','1')");
            c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[数量])
                        VALUES(N'RKNUL1',N'PDNUL1',N'PDNULM',25)");

            var rows = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PDNULM", 状态: "全部");
            var row = Assert.Single(rows);
            Assert.Equal("RKNUL1", row.入仓单号);   // NULL↔NULL 颜色匹配成功，展开一行
            Assert.Equal(25m, row.入仓数量);
            Assert.Equal(60m, row.订购数量);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDNUL1'");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'RKNUL1'");
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDNUL1'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDNUL1'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDNULM'");
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDNULS'");
        }
    }
}
