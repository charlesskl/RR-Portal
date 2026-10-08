using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialInventoryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialInventoryService Svc() => new(Factory());

    private void Seed(Microsoft.Data.SqlClient.SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M01',N'P3面料',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',100)");
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P3LL01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3LL01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',30)");
        c.Execute("INSERT INTO [退料单]([单号],[仓库],[审核]) VALUES(N'P3TL01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [退料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3TL01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',5)");
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P3LL99',N'物料仓','0')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3LL99',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',999)");
    }

    private void Cleanup(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RK01',N'P3RKTX')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'P3LL01',N'P3LL99')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [退料单] WHERE [单号] IN (N'P3TL01')");
        c.Execute("DELETE FROM [报废明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [报废单] WHERE [单号] IN (N'P3BF01')");
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'P3PD01')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P3M01'");
    }

    [SkippableFact]
    public async Task StockOf_applies_signs_and_only_counts_approved()
    {
        using var c = fx.Open();
        Seed(c);
        var stock = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(75m, stock);   // 入100 + 退5 − 领30 = 75（未审核 999 不计）
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_groups_by_material_and_warehouse_with_nonzero_filter()
    {
        using var c = fx.Open();
        Seed(c);
        var rows = await Svc().ListAsync(仓库: null, keyword: "P3M01");
        var row = Assert.Single(rows);
        Assert.Equal("P3M01", row.物料编号);
        Assert.Equal("物料仓", row.仓库);
        Assert.Equal(75m, row.库存数量);
        Assert.Equal("规格A", row.规格);
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_filters_by_warehouse()
    {
        using var c = fx.Open();
        Seed(c);
        Assert.Empty(await Svc().ListAsync(仓库: "不存在仓", keyword: "P3M01"));
        Assert.Single(await Svc().ListAsync(仓库: "物料仓", keyword: "P3M01"));
        Cleanup(c);
    }

    [SkippableFact]
    public async Task StockOf_within_caller_transaction_does_not_commit_it()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        // 在一个会回滚的事务里再插 50 入仓,StockOfAsync 应能看到事务内未提交数据(75+50=125)
        using (var tx = c.BeginTransaction())
        {
            c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RKTX',N'物料仓','1')", transaction: tx);
            c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                        VALUES(N'P3RKTX',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',50)", transaction: tx);
            var inTx = await Svc().StockOfAsync("P3M01", (c, tx));
            Assert.Equal(125m, inTx);
            tx.Rollback();   // 回滚后那 50 不应留下
        }
        var afterRollback = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(75m, afterRollback);
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_excludes_net_zero_material()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P3M01',N'P3面料',N'米')");
        // 入100 + 领100 = 净0,不应出现在库存列表
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'米',100)");
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P3LL01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3LL01',N'物料仓',N'P3M01',N'P3面料',N'米',100)");
        Assert.Empty(await Svc().ListAsync(null, "P3M01"));
        Cleanup(c);
    }

    [SkippableFact]
    public async Task StockOf_subtracts_approved_报废()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [报废明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [报废单] WHERE [单号] IN (N'P3BF01')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P3M01',N'P3面料',N'米')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'米',100)");
        c.Execute("INSERT INTO [报废单]([单号],[仓库],[审核]) VALUES(N'P3BF01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [报废明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3BF01',N'物料仓',N'P3M01',N'P3面料',N'米',20)");
        var stock = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(80m, stock);   // 入100 − 报废20 = 80
        c.Execute("DELETE FROM [报废明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [报废单] WHERE [单号] IN (N'P3BF01')");
        Cleanup(c);
    }

    [SkippableFact]
    public async Task StockOf_applies_approved_盘点盈亏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'P3PD01')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P3M01',N'P3面料',N'米')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'米',100)");
        // 盘点：系统100 盘成80 → 盈亏 -20，审核后库存 = 80
        c.Execute("INSERT INTO [盘点单]([单号],[仓库],[审核]) VALUES(N'P3PD01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [盘点明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[系统数量],[盘点数量],[盈亏数量])
                    VALUES(N'P3PD01',N'物料仓',N'P3M01',N'P3面料',N'米',100,80,-20)");
        var stock = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(80m, stock);   // 入100 + 盘亏(-20) = 80
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'P3PD01')");
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_enriches_货号_物料类别_and_filters_by_类别()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RKA',N'P3RKB')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[货号],[物料类别]) VALUES(N'P3M01',N'面料A',N'米',N'H001',N'面料')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[货号],[物料类别]) VALUES(N'P3M02',N'辅料B',N'个',N'H002',N'辅料')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RKA',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RKA',N'物料仓',N'P3M01',N'面料A',N'米',50)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RKB',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RKB',N'物料仓',N'P3M02',N'辅料B',N'个',30)");
        try
        {
            var all = await Svc().ListAsync(仓库: "物料仓", keyword: null);
            var r1 = Assert.Single(all, x => x.物料编号 == "P3M01");
            Assert.Equal("H001", r1.货号);
            Assert.Equal("面料", r1.物料类别);
            Assert.Contains(all, x => x.物料编号 == "P3M02" && x.物料类别 == "辅料");
            var onlyFabric = await Svc().ListAsync(仓库: "物料仓", keyword: null, 物料类别: "面料");
            Assert.Single(onlyFabric);
            Assert.Equal("P3M01", onlyFabric[0].物料编号);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RKA',N'P3RKB')");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task List_enriches_auxiliary_unit_value_and_location()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'AUXINV01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'AUXINVRK01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'AUXINV01'");

        c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[物料类别],[码换算],[仓库位置])
                    VALUES(N'AUXINV01',N'辅料库存胶纸',N'2.5*90Y',N'卷',N'辅料资料',N'366',N'A-01')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'AUXINVRK01',N'辅料仓库','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXINVRK01',N'辅料仓库',N'AUXINV01',N'辅料库存胶纸',N'2.5*90Y',N'卷',12)");

        try
        {
            var rows = await Svc().ListAsync(仓库: "辅料仓库", keyword: null, 物料类别: "辅料资料");
            var row = Assert.Single(rows, x => x.物料编号 == "AUXINV01");
            Assert.Equal("366", row.每单位数值);
            Assert.Equal("A-01", row.仓库位置);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'AUXINV01'");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'AUXINVRK01'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'AUXINV01'");
        }
    }

    private void CleanupZeroStock(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3MZA',N'P3MZB')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'P3MZRK'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3MZA',N'P3MZB')");
    }

    [SkippableFact]
    public async Task List_include_zero_returns_master_full_without_dropping_stocked_rows()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        CleanupZeroStock(c);
        // P3MZA：主档有、无任何台账 → 含零库存=true 应显示 0
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P3MZA',N'零库存面料',N'米')");
        // P3MZB：不在主档但有库存 → 含零库存=true 也不能丢。
        // 生产库存在此类历史游离台账行（FK 为 not-trusted，导入时未校验），测试库 FK 可信，故临时 NOCHECK 复现该场景。
        c.Execute("ALTER TABLE [采购入仓明细单] NOCHECK CONSTRAINT [FK_203_查找]");
        try
        {
            c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3MZRK',N'物料仓','1')");
            c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                        VALUES(N'P3MZRK',N'物料仓',N'P3MZB',N'台账独有料',N'个',40)");
            var withZero = await Svc().ListAsync(仓库: null, keyword: "P3MZ", 含零库存: true);
            var za = Assert.Single(withZero, x => x.物料编号 == "P3MZA");
            Assert.Equal(0m, za.库存数量);
            Assert.Equal("零库存面料", za.物料名称);
            var zb = Assert.Single(withZero, x => x.物料编号 == "P3MZB");
            Assert.Equal(40m, zb.库存数量);
            Assert.Equal("台账独有料", zb.物料名称);
            // =false 行为不变：只回有库存的
            var noZero = await Svc().ListAsync(仓库: null, keyword: "P3MZ", 含零库存: false);
            Assert.DoesNotContain(noZero, x => x.物料编号 == "P3MZA");
            Assert.Single(noZero, x => x.物料编号 == "P3MZB");
        }
        finally
        {
            CleanupZeroStock(c);
            c.Execute("ALTER TABLE [采购入仓明细单] WITH CHECK CHECK CONSTRAINT [FK_203_查找]");
        }
    }

    private void CleanupAuxiliaryMonthly(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'AUXMRK0',N'AUXMRK1',N'AUXMIGN')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [退料单] WHERE [单号] IN (N'AUXMTL1')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'AUXMLL1')");
        c.Execute("DELETE FROM [采购退仓明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [采购退仓单] WHERE [单号] IN (N'AUXMCT1')");
        c.Execute("DELETE FROM [报废明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [报废单] WHERE [单号] IN (N'AUXMBF1')");
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'AUXMPD1')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'AUXMON01',N'AUXMON02')");
    }

    [SkippableFact]
    public async Task Monthly_splits_auxiliary_opening_current_movement_and_stocktake()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        CleanupAuxiliaryMonthly(c);

        c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[物料类别],[码换算])
                    VALUES(N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',N'辅料资料',N'366')");
        c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[物料类别])
                    VALUES(N'AUXMON02',N'非辅料月报',N'规格B',N'个',N'面料')");

        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMRK0',N'辅料仓库','2026-06-30','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMRK0',N'辅料仓库','2026-06-30',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',10)");

        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMRK1',N'辅料仓库','2026-07-02','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMRK1',N'辅料仓库','2026-07-02',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',5)");

        c.Execute("INSERT INTO [退料单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMTL1',N'辅料仓库','2026-07-03','1')");
        c.Execute(@"INSERT INTO [退料明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMTL1',N'辅料仓库','2026-07-03',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',2)");

        c.Execute("INSERT INTO [领料单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMLL1',N'辅料仓库','2026-07-04','1')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMLL1',N'辅料仓库','2026-07-04',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',4)");

        c.Execute("INSERT INTO [采购退仓单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMCT1',N'辅料仓库','2026-07-05','1')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMCT1',N'辅料仓库','2026-07-05',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',1)");

        c.Execute("INSERT INTO [报废单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMBF1',N'辅料仓库','2026-07-06','1')");
        c.Execute(@"INSERT INTO [报废明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMBF1',N'辅料仓库','2026-07-06',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',3)");

        c.Execute("INSERT INTO [盘点单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMPD1',N'辅料仓库','2026-07-07','1')");
        c.Execute(@"INSERT INTO [盘点明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[系统数量],[盘点数量],[盈亏数量])
                    VALUES(N'AUXMPD1',N'辅料仓库','2026-07-07',N'AUXMON01',N'辅料月报胶纸',N'2.5*90Y',N'卷',12,10,-2)");

        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[日期],[审核]) VALUES(N'AUXMIGN',N'物料仓','2026-07-02','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[日期],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'AUXMIGN',N'物料仓','2026-07-02',N'AUXMON02',N'非辅料月报',N'规格B',N'个',99)");

        try
        {
            var rows = await Svc().MonthlyAsync(
                new DateTime(2026, 7, 1),
                new DateTime(2026, 7, 31),
                仓库: "辅料仓库",
                物料类别: "辅料资料",
                keyword: "月报胶纸");

            var row = Assert.Single(rows);
            Assert.Equal("AUXMON01", row.物料编号);
            Assert.Equal("辅料月报胶纸", row.物料名称);
            Assert.Equal("2.5*90Y", row.规格);
            Assert.Equal("366", row.每单位数值);
            Assert.Equal(10m, row.期初库存);
            Assert.Equal(7m, row.本期入库);
            Assert.Equal(8m, row.本期出库);
            Assert.Equal(-2m, row.盘点盈亏);
            Assert.Equal(7m, row.期末库存);
        }
        finally
        {
            CleanupAuxiliaryMonthly(c);
        }
    }
}
