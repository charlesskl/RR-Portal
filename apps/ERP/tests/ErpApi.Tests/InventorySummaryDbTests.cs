using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class InventorySummaryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string,string?>{ ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task In_minus_out_only_counts_approved()
    {
        using var c = fx.Open();
        // 清理（先删明细，再删主单/基础资料，满足外键顺序）
        c.Execute(@"DELETE FROM [成品入仓明细单] WHERE 款号=N'K0';
                    DELETE FROM [成品出仓明细单] WHERE 款号=N'K0';
                    DELETE FROM [成品入仓单]   WHERE 单号 IN (N'I1',N'I2');
                    DELETE FROM [成品出仓单]   WHERE 单号 = N'O1';
                    DELETE FROM [款号总表]     WHERE 款号 = N'K0';");

        // 满足外键：款号总表(款号) + 成品入仓单/出仓单(单号)
        c.Execute(@"INSERT INTO [款号总表](款号,款式) VALUES (N'K0', N'测试款');");
        c.Execute(@"INSERT INTO [成品入仓单](单号,仓库,审核) VALUES (N'I1',N'W1',N'1'),(N'I2',N'W1',N'0');");
        c.Execute(@"INSERT INTO [成品出仓单](单号,仓库,审核) VALUES (N'O1',N'W1',N'1');");

        // 入100(审核) + 入50(未审,应忽略) - 出30(审核) = 70
        c.Execute(@"INSERT INTO [成品入仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES(N'I1',N'W1',N'K0',N'红',N'M',100,N'1')");
        c.Execute(@"INSERT INTO [成品入仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES(N'I2',N'W1',N'K0',N'红',N'M',50,N'0')");
        c.Execute(@"INSERT INTO [成品出仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES(N'O1',N'W1',N'K0',N'红',N'M',30,N'1')");

        var rows = await new InventorySummaryService(Factory()).FinishedGoodsAsync("W1");
        var k0 = rows.Single(r => r.款号 == "K0" && r.颜色 == "红" && r.尺码 == "M");
        Assert.Equal(70m, k0.库存);
    }

    [SkippableFact]
    public async Task FinishedGoods_includes_审核入仓_minus_出仓_plus_盘点盈亏()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // 主从 FK：明细单.单号 → 各主单.单号，故先插主单
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKD',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品出仓单]([单号],[仓库],[审核]) VALUES(N'P5CKD',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5PDD',N'P5成品仓','1')");

            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5RKD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5CKD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',30,'1')");
            c.Execute(@"INSERT INTO [成品盘点明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量],[审核])
                        VALUES(N'P5PDD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',70,68,-2,'1')");

            var rows = await new InventorySummaryService(Factory()).FinishedGoodsAsync("P5成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5K01", r.款号);
            Assert.Equal(68m, r.库存);
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKD'");
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]='P5CKD'");
            c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]='P5PDD'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FinishedGoods_transfer_moves_qty_between_warehouses()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BRK',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品调拨单]([单号],[源仓库],[目标仓库],[审核]) VALUES(N'P5BCD',N'P5成品仓',N'P5半成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
            c.Execute(@"INSERT INTO [成品调拨明细单]([单号],[源仓库],[目标仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BCD',N'P5成品仓',N'P5半成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',30,'1')");
            var svc = new InventorySummaryService(Factory());
            Assert.Equal(70m, (await svc.FinishedGoodsAsync("P5成品仓"))[0].库存);     // 100-30
            Assert.Equal(30m, (await svc.FinishedGoodsAsync("P5半成品仓"))[0].库存);   // +30
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BRK'");
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]='P5BCD'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BRK'");
            c.Execute("DELETE FROM [成品调拨单] WHERE [单号]='P5BCD'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task SemiFinished_in_minus_issue_plus_盘点盈亏()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        try
        {
            // 半成品明细单无 审核 列；审核状态在主单。明细仅录数量/物料维度。
            c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CSRK',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量])
                        VALUES(N'P5CSRK',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',100)");
            c.Execute("INSERT INTO [半成品领料单]([单号],[仓库],[审核]) VALUES(N'P5CSLL',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品领料明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量])
                        VALUES(N'P5CSLL',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',30)");
            c.Execute("INSERT INTO [半成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5CSPD',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品盘点明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[系统数量],[盘点数量],[盈亏数量])
                        VALUES(N'P5CSPD',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',70,68,-2)");

            var rows = await new InventorySummaryService(Factory()).SemiFinishedAsync("P5c半成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5cM1", r.物料编号);
            Assert.Equal(68m, r.库存);   // 100 - 30 + (-2)
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]='P5CSRK'");
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CSRK'");
            c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]='P5CSLL'");
            c.Execute("DELETE FROM [半成品领料单] WHERE [单号]='P5CSLL'");
            c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号]='P5CSPD'");
            c.Execute("DELETE FROM [半成品盘点单] WHERE [单号]='P5CSPD'");
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task SemiFinished_deducts_装配领料单_outbound()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        try
        {
            // 半成品入仓 100(已审核)；装配部领料单(仓库=半成品仓)：P5CLL1 未审核但已出 25(按 已出数量 扣)、P5CLL2 已审核全量 10(已出数量 空按 数量 扣)
            c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CSRK2',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量])
                        VALUES(N'P5CSRK2',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',100)");
            c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P5CLL1',N'P5c半成品仓','0')");
            c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量],[已出数量])
                        VALUES(N'P5CLL1',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',40,25)");
            c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P5CLL2',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量])
                        VALUES(N'P5CLL2',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',10)");

            var rows = await new InventorySummaryService(Factory()).SemiFinishedAsync("P5c半成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5cM1", r.物料编号);
            Assert.Equal(65m, r.库存);   // 100 - 25 - 10
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号] IN (N'P5CLL1',N'P5CLL2')");
            c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'P5CLL1',N'P5CLL2')");
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]='P5CSRK2'");
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CSRK2'");
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FinishedGoods_deducts_装配领料单_outbound()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // 成品入仓 100(色号/尺码 空,与领料行同组净额)；装配部领料单(仓库=成品仓,返工领出)未审核但已出 30 → 70
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKD2',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[颜色],[数量],[审核])
                        VALUES(N'P5RKD2',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'黑色',100,'1')");
            c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P5LL01',N'P5成品仓','0')");
            c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[生产单号],[款号],[颜色],[数量],[已出数量])
                        VALUES(N'P5LL01',N'P5成品仓',N'P5SC01',N'P5K01',N'黑色',30,30)");

            var rows = await new InventorySummaryService(Factory()).FinishedGoodsAsync("P5成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5K01", r.款号);
            Assert.Null(r.色号);
            Assert.Null(r.尺码);
            Assert.Equal(70m, r.库存);   // 100 - 30
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=N'P5LL01'");
            c.Execute("DELETE FROM [领料单] WHERE [单号]=N'P5LL01'");
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKD2'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKD2'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FinishedGoodsByItem_groups_by_配件编号_and_maps_出仓_via_款号()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // 入仓两行同配件编号(100+50,审核) + 一行未审(应忽略)；出仓只有 款号，靠 款号→配件编号 映射归并 -30 → 120
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5IRK',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品出仓单]([单号],[仓库],[审核]) VALUES(N'P5ICK',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[配件编号],[客户],[货号],[名称],[产品装配名称],[数量],[审核])
                        VALUES(N'P5IRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5PJ-A',N'P5客户A',N'P5K01',N'P5名称A',N'P5装配A',100,'1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[配件编号],[客户],[货号],[名称],[产品装配名称],[数量],[审核])
                        VALUES(N'P5IRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5PJ-A',N'P5客户A',N'P5K01',N'P5名称A',N'P5装配A',50,'1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[配件编号],[客户],[货号],[名称],[产品装配名称],[数量],[审核])
                        VALUES(N'P5IRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5PJ-A',N'P5客户A',N'P5K01',N'P5名称A',N'P5装配A',999,'0')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[仓库],[生产单号],[款号],[数量],[审核])
                        VALUES(N'P5ICK',N'P5成品仓',N'P5SC01',N'P5K01',30,'1')");

            var rows = await new InventorySummaryService(Factory()).FinishedGoodsByItemAsync("P5成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5PJ-A", r.配件编号);
            Assert.Equal("P5客户A", r.客户);
            Assert.Equal("P5K01", r.产品货号);
            Assert.Equal("P5名称A", r.产品名称);
            Assert.Equal("P5装配A", r.产品装配名称);
            Assert.Equal(120m, r.库存数量);   // 100 + 50 - 30（未审 999 忽略）
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=N'P5IRK'");
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=N'P5ICK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=N'P5IRK'");
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=N'P5ICK'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task FinishedGoodsLedger_returns_ordered_signed_flow()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // 入仓 +100(01-02) → 出仓 -30(01-03) → 盘点盈亏 -2(01-04)：按 日期,单号 排序，盈亏负计入出库数量
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5LRK',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品出仓单]([单号],[仓库],[审核]) VALUES(N'P5LCK',N'P5成品仓','1')");
            c.Execute("INSERT INTO [成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5LPD',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[配件编号],[数量],[审核])
                        VALUES(N'P5LRK','2026-01-02',N'P5成品仓',N'P5SC01',N'P5K01',N'P5PJ-A',100,'1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[数量],[审核])
                        VALUES(N'P5LCK','2026-01-03',N'P5成品仓',N'P5SC01',N'P5K01',30,'1')");
            c.Execute(@"INSERT INTO [成品盘点明细单]([单号],[日期],[仓库],[生产单号],[款号],[系统数量],[盘点数量],[盈亏数量],[审核])
                        VALUES(N'P5LPD','2026-01-04',N'P5成品仓',N'P5SC01',N'P5K01',70,68,-2,'1')");

            var rows = await new InventorySummaryService(Factory()).FinishedGoodsLedgerAsync("P5成品仓", "P5PJ-A");
            Assert.Equal(3, rows.Count);
            Assert.Equal("P5LRK", rows[0].单号);
            Assert.Equal("成品入仓", rows[0].类型);
            Assert.Equal(100m, rows[0].入库数量);
            Assert.Null(rows[0].出库数量);
            Assert.Equal("P5LCK", rows[1].单号);
            Assert.Equal("成品出仓", rows[1].类型);
            Assert.Equal(30m, rows[1].出库数量);
            Assert.Equal("P5LPD", rows[2].单号);
            Assert.Equal("盘点盈亏", rows[2].类型);
            Assert.Equal(2m, rows[2].出库数量);
            // 前端累计结存应为 100 → 70 → 68
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=N'P5LRK'");
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=N'P5LCK'");
            c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=N'P5LPD'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=N'P5LRK'");
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=N'P5LCK'");
            c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=N'P5LPD'");
            P5TestData.Cleanup(c);
        }
    }
}
