using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseOrderDbTests(DbFixture fx)
{
    private const string 供应商编号 = "POS01";
    private const string 生产单号 = "POMO0001";
    private const string 物料1 = "POM01";
    private const string 物料2 = "POM02";
    private const string 塑胶物料 = "POM03";
    private const string 未建档物料 = "POM99";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    // FK-safe 种子：供应商资料 + 生产制单(生产单号) + 物料资料 + 生产BOM物料清单(2行)。
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(@s,N'PO测试供应商')", new { s = 供应商编号 });
        c.Execute("INSERT INTO [生产制单]([生产单号],[审核],[合同号]) VALUES(@mo,'1',N'HT-PO')", new { mo = 生产单号 });
        // 采购分析审核(独立审核层):下单门要求 生产单已审 + 分析已审
        c.Execute("INSERT INTO [采购分析审核]([生产单号],[审核],[审核人],[审核时间]) VALUES(@mo,'1',N't',GETDATE())", new { mo = 生产单号 });
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'POM01',N'PO面料',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'POM02',N'PO纽扣',N'规格B',N'粒',0.5)");
        c.Execute(@"INSERT INTO [生产BOM物料清单]([生产单号],[物料编号],[物料名称],[规格],[颜色],[单位],[总数量],[库存数量],[可用库存],[需订数量],[预算单价],[供应商编号],[供应商名称])
                    VALUES(@mo,N'POM01',N'PO面料',N'规格A',N'黑色',N'米',100,20,20,80,10,@s,N'PO测试供应商'),
                          (@mo,N'POM02',N'PO纽扣',N'规格B',N'白色',N'粒',200,0,0,200,0.5,@s,N'PO测试供应商')",
            new { mo = 生产单号, s = 供应商编号 });
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购明细单] WHERE [物料编号] IN (N'POM01',N'POM02') OR [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [采购订单] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [采购分析审核] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'POM01',N'POM02')");
        c.Execute("DELETE FROM [采购物料设置] WHERE [物料编号] IN (N'POM01',N'POM02')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=@s", new { s = 供应商编号 });
    }

    // 下单损耗：采购物料设置.采购损耗率 随基准行带出(前端默认数量=需订×(1+损耗率/100))。
    [SkippableFact]
    public async Task Basis_returns_purchase_loss_rate()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            c.Execute("INSERT INTO [采购物料设置]([物料编号],[采购损耗率]) VALUES(N'POM01',6.67)");
            var rows = await Svc().BasisAsync(生产单号);
            Assert.Equal(6.67m, rows.First(r => r.物料编号 == "POM01").采购损耗率);
            Assert.Null(rows.First(r => r.物料编号 == "POM02").采购损耗率);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Basis_returns_bom_rows()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().BasisAsync(生产单号);
            Assert.Equal(2, rows.Count);
            Assert.Equal("POM01", rows[0].物料编号);
            Assert.True(rows[0].ID > 0); // 生产BOM物料清单.ID(分析页勾选行按它对齐)
            Assert.Equal(80m, rows[0].需订数量);
            Assert.Equal(供应商编号, rows[0].供应商编号);
        }
        finally { Cleanup(c); }
    }

    // 来料仓口径：物料类别含「塑胶」的行 + 未在物料资料建档的行 都不带出；合同号随行返回（前端自动填 PO号）。
    [SkippableFact]
    public async Task Basis_excludes_plastic_and_unfiled_materials_and_returns_contract_no()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("UPDATE [生产制单] SET [合同号]=N'HT-001' WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价],[物料类别]) VALUES(N'POM03',N'PO胶壳',N'规格C',N'PCS',1,N'ZURU塑胶')");
        c.Execute(@"INSERT INTO [生产BOM物料清单]([生产单号],[物料编号],[物料名称],[规格],[颜色],[单位],[总数量],[库存数量],[可用库存],[需订数量],[预算单价])
                    VALUES(@mo,N'POM03',N'PO胶壳',N'规格C',N'',N'PCS',10,0,0,10,1),
                          (@mo,N'POM99',N'未建档胶件',N'',N'',N'PCS',5,0,0,5,1)",
            new { mo = 生产单号 });
        try
        {
            var rows = await Svc().BasisAsync(生产单号);
            Assert.Equal(2, rows.Count);
            Assert.DoesNotContain(rows, r => r.物料编号 == 塑胶物料 || r.物料编号 == 未建档物料);
            Assert.All(rows, r => Assert.Equal("HT-001", r.合同号));
        }
        finally
        {
            c.Execute("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=@mo AND [物料编号] IN (N'POM03',N'POM99')", new { mo = 生产单号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'POM03'");
            Cleanup(c);
        }
    }

    // 分析门：生产通知单未审核 → basis 拒绝带料、create 拒绝下单
    [SkippableFact]
    public async Task Basis_and_Create_blocked_when_mo_unapproved()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("UPDATE [生产制单] SET [审核]='0' WHERE [生产单号]=@mo", new { mo = 生产单号 });
        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().BasisAsync(生产单号));
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 生产单号 = 生产单号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }],
            }, "ut"));
        }
        finally { Cleanup(c); }
    }

    // 采购分析门(独立审核层):生产通知单已审核但采购分析未审核 → basis/create 同样拒绝
    [SkippableFact]
    public async Task Basis_and_Create_blocked_when_采购分析未审核()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("DELETE FROM [采购分析审核] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        try
        {
            var ex1 = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().BasisAsync(生产单号));
            Assert.Contains("采购分析单", ex1.Message);
            var ex2 = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 生产单号 = 生产单号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }],
            }, "ut"));
            Assert.Contains("采购分析单", ex2.Message);
        }
        finally { Cleanup(c); }
    }

    // 单供应商门:物料在物料资料绑定的默认供应商与本单不一致 → 拒绝;改绑回本供应商 → 放行
    [SkippableFact]
    public async Task Create_blocked_when_material_bound_to_other_supplier()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'POS02',N'PO另一供应商')");
        c.Execute("UPDATE [物料资料] SET [供应商编号]=N'POS02' WHERE [物料编号]=N'POM01'");
        try
        {
            var ex = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 生产单号 = 生产单号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }],
            }, "ut"));
            Assert.Contains("一个供应商", ex.Message);
            // 改绑回本供应商则放行
            c.Execute("UPDATE [物料资料] SET [供应商编号]=@s WHERE [物料编号]=N'POM01'", new { s = 供应商编号 });
            var 单号 = await Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 生产单号 = 生产单号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }],
            }, "ut");
            Assert.StartsWith("PO", 单号);
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
        }
        finally
        {
            Cleanup(c);
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'POS02'");
        }
    }

    // 可用库存取实时库存(库存引擎聚合)，不用 BOM 快照：快照 20，入仓 500 后 basis 应返回 500
    [SkippableFact]
    public async Task Basis_returns_live_available_stock_not_bom_snapshot()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PORKLIVE',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PORKLIVE',N'物料仓',N'POM01',N'PO面料',N'规格A',N'米',500)");
        try
        {
            var rows = await Svc().BasisAsync(生产单号);
            Assert.Equal(500m, rows.Single(r => r.物料编号 == 物料1).可用库存);
            Assert.Equal(0m, rows.Single(r => r.物料编号 == 物料2).可用库存);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'PORKLIVE'");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PORKLIVE'");
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_from_basis_writes_header_and_lines_with_totals()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        var basis = await Svc().BasisAsync(生产单号);
        var dto = new PurchaseOrderCreateDto
        {
            生产单号 = 生产单号, 供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 仓库 = "物料仓",
            明细 = [.. basis.Select(b => new PurchaseOrderLineDto
            {
                物料编号 = b.物料编号, 物料名称 = b.物料名称, 规格 = b.规格, 颜色 = b.颜色, 单位 = b.单位,
                数量 = b.需订数量 ?? 0, 单价 = b.预算单价, 预算数量 = b.总数量
            })]
        };
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            Assert.StartsWith("PO", 单号);
            // 数量合计 = 80 + 200 = 280；金额合计 = 80*10 + 200*0.5 = 900
            Assert.Equal(280m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [采购订单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(900m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购订单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [采购订单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(800m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购明细单] WHERE [单号]=@单号 AND [物料编号]=N'POM01'", new { 单号 }));

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            Assert.Equal(生产单号, detail.单头!.生产单号);
            // 合同号绑定：未传 PO号 时自动带出 生产制单.合同号
            Assert.Equal("HT-PO", detail.单头!.PO号);

            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购订单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines_and_blank_supplier()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new PurchaseOrderCreateDto { 供应商编号 = 供应商编号, 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new PurchaseOrderCreateDto { 供应商编号 = null, 明细 = [new PurchaseOrderLineDto { 物料编号 = "X", 数量 = 1 }] }, "tester"));
    }

    // 合同号(PO号)必填：无生产单号可自动带出、也未手填 PO号 → 拒单
    [SkippableFact]
    public async Task Create_rejects_missing_contract_no()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号,
                明细 = [new PurchaseOrderLineDto { 物料编号 = "X", 数量 = 1 }],
            }, "tester"));
        Assert.Contains("合同号", ex.Message);
    }

    // 改单回归:事务内按生产单号绑 PO号(此前裸查不传事务必抛 SqlException);数量/金额按明细重算
    [SkippableFact]
    public async Task Update_binds_po号_inside_transaction()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        string? 单号 = null;
        try
        {
            单号 = await Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                生产单号 = 生产单号, 供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 仓库 = "物料仓",
                明细 = [new PurchaseOrderLineDto { 物料编号 = "POM01", 物料名称 = "PO面料", 单位 = "米", 数量 = 80, 单价 = 10 }]
            }, "tester");

            // 不传 PO号:由 生产单号 → 生产制单.合同号 在事务内自动带出
            Assert.True(await Svc().UpdateAsync(单号, new PurchaseOrderCreateDto
            {
                生产单号 = 生产单号, 供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 仓库 = "物料仓",
                明细 = [new PurchaseOrderLineDto { 物料编号 = "POM02", 物料名称 = "PO纽扣", 单位 = "粒", 数量 = 200, 单价 = 0.5m }]
            }, "tester"));

            var detail = await Svc().GetAsync(单号);
            Assert.Equal("HT-PO", detail!.单头!.PO号);
            Assert.Equal(200m, detail.单头!.数量);
            Assert.Equal(100m, detail.单头!.金额);
            var line = Assert.Single(detail.明细);
            Assert.Equal("POM02", line.物料编号);
        }
        finally
        {
            if (单号 != null)
            {
                c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
                c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
            }
            Cleanup(c);
        }
    }

    // 分析门(update 同 create):改单改挂到 未审核/不存在 的生产通知单 → 拒单
    [SkippableFact]
    public async Task Update_blocked_when_mo_unapproved_or_missing()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        string? 单号 = null;
        try
        {
            单号 = await Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                生产单号 = 生产单号, 供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 仓库 = "物料仓",
                明细 = [new PurchaseOrderLineDto { 物料编号 = "POM01", 物料名称 = "PO面料", 单位 = "米", 数量 = 80, 单价 = 10 }]
            }, "tester");

            // 改挂到不存在的生产通知单
            var missing = await Assert.ThrowsAsync<ArgumentException>(() => Svc().UpdateAsync(单号, new PurchaseOrderCreateDto
            {
                生产单号 = "POMO-VOID", 供应商编号 = 供应商编号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = "POMO-VOID", 物料编号 = "POM01", 数量 = 1 }]
            }, "tester"));
            Assert.Contains("不存在", missing.Message);

            // 源单被反审核后,改单(即使不换挂)也拒
            c.Execute("UPDATE [生产制单] SET [审核]='0' WHERE [生产单号]=@mo", new { mo = 生产单号 });
            var unapproved = await Assert.ThrowsAsync<ArgumentException>(() => Svc().UpdateAsync(单号, new PurchaseOrderCreateDto
            {
                生产单号 = 生产单号, 供应商编号 = 供应商编号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }]
            }, "tester"));
            Assert.Contains("未审核", unapproved.Message);

            // 原单数据未被改动
            var detail = await Svc().GetAsync(单号);
            Assert.Equal(80m, detail!.单头!.数量);
        }
        finally
        {
            if (单号 != null)
            {
                c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
                c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
            }
            Cleanup(c);
        }
    }

    // 保存回填:下单物料未绑默认供应商的,保存后绑到本单供应商(物料资料主档+该生产单BOM快照行);
    // 已绑别家的依旧被 校验单供应商 拦(见上单),这里只验证只填空不覆盖
    [SkippableFact]
    public async Task Create_backfills_blank_supplier_to_master_and_bom_snapshot()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        // POM02 清空绑定(快照行),模拟未绑定供应商的物料(主档本就未绑)
        c.Execute("UPDATE [生产BOM物料清单] SET [供应商编号]=NULL,[供应商名称]=NULL WHERE [生产单号]=@mo AND [物料编号]=N'POM02'", new { mo = 生产单号 });
        string? 单号 = null;
        try
        {
            单号 = await Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 生产单号 = 生产单号,
                明细 =
                [
                    new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 },
                    new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM02", 数量 = 2 },
                ],
            }, "ut");
            // 物料资料主档回填(日后新单自动归组)
            Assert.Equal(供应商编号, c.ExecuteScalar<string?>("SELECT [供应商编号] FROM [物料资料] WHERE [物料编号]=N'POM02'"));
            Assert.Equal("PO测试供应商", c.ExecuteScalar<string?>("SELECT [供应商名称] FROM [物料资料] WHERE [物料编号]=N'POM02'"));
            // BOM 快照行回填(采购物料分析按供应商分组的来源)
            Assert.Equal(供应商编号, c.ExecuteScalar<string?>("SELECT [供应商编号] FROM [生产BOM物料清单] WHERE [生产单号]=@mo AND [物料编号]=N'POM02'", new { mo = 生产单号 }));
        }
        finally
        {
            if (单号 is not null)
            {
                c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
                c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
            }
            Cleanup(c);
        }
    }

    // 详情回归:重开已存单,明细带行级供应商(下单时=单头供应商)与实时可用库存
    [SkippableFact]
    public async Task Get_returns_line_supplier_and_live_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PORKDET',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PORKDET',N'物料仓',N'POM01',N'PO面料',N'规格A',N'米',500)");
        string? 单号 = null;
        try
        {
            单号 = await Svc().CreateAsync(new PurchaseOrderCreateDto
            {
                供应商编号 = 供应商编号, 供应商名称 = "PO测试供应商", 生产单号 = 生产单号,
                明细 = [new PurchaseOrderLineDto { 生产单号 = 生产单号, 物料编号 = "POM01", 数量 = 1 }],
            }, "ut");
            var detail = await Svc().GetAsync(单号);
            var line = Assert.Single(detail!.明细);
            Assert.Equal(供应商编号, line.供应商编号);
            Assert.Equal("PO测试供应商", line.供应商名称);
            Assert.Equal(500m, line.可用库存);   // 实时库存(库存引擎聚合),不是 BOM 快照的 20
        }
        finally
        {
            if (单号 is not null)
            {
                c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 });
                c.Execute("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 });
            }
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'PORKDET'");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PORKDET'");
            Cleanup(c);
        }
    }
}
