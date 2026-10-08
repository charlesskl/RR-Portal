using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Orders;
using ErpApi.Features.Production;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ProductionServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ProductionService Svc() =>
        new(Factory(), new DocumentNumberGenerator(),
            new ErpApi.Engines.Inventory.MaterialInventoryService(Factory()));

    // 单货号 DTO（等价于旧的单款号覆盖）：货号=BOM款号=P2TK01，色码合计 100
    private static ProductionNoticeCreateDto Dto() => new()
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
        交货日期 = new DateTime(2026, 8, 1),
        货号明细 =
        [
            new ProductionGoodsLineDto
            {
                货号 = P2TestData.款号, BOM款号 = P2TestData.款号, 款号名称 = "P2测试款式", 比例 = 1m, 分析 = true,
                数量明细 =
                [
                    new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 40 },
                    new ProductionQtyDto { 颜色 = "黑色", 尺码 = "M", 数量 = 30 },
                    new ProductionQtyDto { 颜色 = "白色", 尺码 = "L", 数量 = 30 },
                ]
            }
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_qty_and_expands_processes_算法3()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");
        Assert.StartsWith("SC", 生产单号);   // 前缀SC+yyyyMMdd+流水

        // 单头：计划数量 = 100
        Assert.Equal(100m, c.ExecuteScalar<decimal>(
            "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        // 数量明细 3 行
        Assert.Equal(3, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单数量] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        // === 算法3 工序展开断言 ===
        // 款号有 2 道工序(裁床1.5 + 车缝2.5) → 复制到生产制单工序表
        Assert.Equal(2, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        // 单头汇总：工序数=2，工序单价=4.0（单件工费）
        Assert.Equal(2m, Convert.ToDecimal(c.ExecuteScalar<object>(
            "SELECT [工序数] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 })));
        Assert.Equal(4.0m, c.ExecuteScalar<decimal>(
            "SELECT [工序单价] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        // 计划工费 = 计划数量 × 单件工费 = 100 × 4 = 400（口径校验，不落库，由前端/报表算）
        var 工序单价 = c.ExecuteScalar<decimal>(
            "SELECT [工序单价] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        var 计划数量 = c.ExecuteScalar<decimal>(
            "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        Assert.Equal(400m, 工序单价 * 计划数量);
        // 复制的工序内容正确
        Assert.Equal(1.5m, c.ExecuteScalar<decimal>(
            "SELECT [单价] FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [工序名称]=N'裁床'", new { 生产单号 }));

        // 新单未审核
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_rejects_empty_qty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto();
        dto.货号明细[0].数量明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    // 硬闸:BOM款号 在 款号物料明细表 一行都没有 = 未建 BOM → 拒单(排期弹窗/通知单页只是前端提示,服务端兜底)
    [SkippableFact]
    public async Task Create_rejects_when_bom_missing()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        try
        {
            var dto = Dto();
            dto.货号明细[0].BOM款号 = "P2TK01-无BOM";
            var ex = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
            Assert.Contains("还没有建 BOM", ex.Message);
            // 拒单不落任何数据
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [款号]=N'P2TK01-无BOM'"));
        }
        finally { P2TestData.Cleanup(c); }
    }

    // 实单版 BOM(半成品行):算法4 仍剔除不进 生产BOM物料清单(采购口径),
    // 但详情实时带出 半成品需求(用量×货号数量),供半成品仓/装配领料对照
    [SkippableFact]
    public async Task Get_returns_半成品需求_for_semi_bom_rows()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        try
        {
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P2-SEMI',N'P2半成品包',N'个')");
            c.Execute("INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[用量],[操作员]) VALUES(N'P2TK01',N'P2-SEMI',N'半成品',1,1,N't')");
            c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[物料类别],[单位],[使用数量])
                        VALUES(N'P2TK01',N'P2测试款式',N'P2-SEMI',N'P2半成品包',N'半成品',N'个',0.5)");

            var 生产单号 = await Svc().CreateAsync(Dto(), "tester"); // 数量合计 100

            // 快照仍不含半成品(来料采购不被污染)
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2-SEMI'",
                new { 生产单号 }));

            var d = await Svc().GetAsync(生产单号);
            var need = Assert.Single(d!.半成品需求);
            Assert.Equal("P2TK01", need.货号);
            Assert.Equal("P2-SEMI", need.物料编号);
            Assert.Equal("P2半成品包", need.物料名称);
            Assert.Equal(0.5m, need.用量);
            Assert.Equal(50m, need.总数量);   // 0.5 × 100
            // 普通物料行进快照,不进半成品需求
            Assert.Equal(2, d.物料.Count);
            Assert.DoesNotContain(d.半成品需求, x => x.物料编号 == "P2TM01");
        }
        finally
        {
            c.Execute("DELETE FROM [半成品设置] WHERE [名称]=N'P2-SEMI'");
            P2TestData.Cleanup(c);
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P2-SEMI'");
        }
    }

    [SkippableFact]
    public async Task Create_expands_bom_with_shortage_算法4()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");
        // 计划数量 = 100；BOM: 面料用量2(单价10)、纽扣用量0.5(单价0.2)

        // === 算法4 断言 ===
        // 面料需求 = 2 × 100 = 200；库存 0 → 需订 200；金额 = 200×10 = 2000
        var 面料 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM01'",
            new { 生产单号 });
        Assert.Equal(200m, (decimal)面料.总数量);
        Assert.Equal(0m, (decimal)面料.库存数量);
        Assert.Equal(200m, (decimal)面料.需订数量);
        Assert.Equal(10m, (decimal)面料.预算单价);
        Assert.Equal(2000m, (decimal)面料.金额);

        // 纽扣需求 = 0.5 × 100 = 50；金额 = 50×0.2 = 10
        var 纽扣 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM02'",
            new { 生产单号 });
        Assert.Equal(50m, (decimal)纽扣.总数量);
        Assert.Equal(50m, (decimal)纽扣.需订数量);
        Assert.Equal(10m, (decimal)纽扣.金额);

        // 单头物料金额 = 2000 + 10 = 2010
        Assert.Equal(2010m, c.ExecuteScalar<decimal>(
            "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_bom_deducts_material_stock_when_available()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);

        // 模拟已审核采购入仓 120 米面料（库存扣减验证：需求200 - 库存120 = 需订80）
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'P2TCG01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'P2TCG01'");
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'P2TCG01','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[物料编号],[物料名称],[数量])
                    VALUES(N'P2TCG01',N'P2TM01',N'P2面料',120)");

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");

        var 面料 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM01'",
            new { 生产单号 });
        Assert.Equal(200m, (decimal)面料.总数量);
        Assert.Equal(120m, (decimal)面料.库存数量);
        Assert.Equal(80m, (decimal)面料.需订数量);   // 缺料 = 需求 - 库存

        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'P2TCG01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'P2TCG01'");
        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_from_order_links_生产单号_back_to_order()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);

        // 先建一张订单
        var orderSvc = new OrderService(Factory(), new DocumentNumberGenerator());
        var 订单单号 = await orderSvc.CreateAsync(new OrderCreateDto
        {
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            款号 = P2TestData.款号, 款式 = "P2测试款式", 单价 = 100m,
            明细 = [new OrderLineDto { 颜色 = "黑色", 尺码 = "S", 数量 = 100 }]
        }, "tester");

        // 从订单生成生产制单
        var dto = Dto();
        dto.订单单号 = 订单单号;
        var 生产单号 = await Svc().CreateAsync(dto, "tester");

        // 回写：订单总表/明细表 的 生产单号 字段被填上
        Assert.Equal(生产单号, c.ExecuteScalar<string>(
            "SELECT [生产单号] FROM [成品客户订单总表] WHERE [单号]=@订单单号", new { 订单单号 }));
        Assert.Equal(生产单号, c.ExecuteScalar<string>(
            "SELECT TOP 1 [生产单号] FROM [成品客户订单明细表] WHERE [单号]=@订单单号", new { 订单单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task List_Get_and_Delete_production_order()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");

        // 列表
        var page = await Svc().ListAsync(1, 20, 生产单号);
        Assert.Equal(1, page.Total);
        Assert.Equal(生产单号, page.Items[0].生产单号);

        // 详情：单头 + 3行数量 + 2道工序 + 2行BOM
        var detail = await Svc().GetAsync(生产单号);
        Assert.NotNull(detail);
        Assert.Equal(P2TestData.款号, detail!.单头!.款号);
        Assert.Equal(3, detail.数量.Count);
        Assert.Equal(2, detail.工序.Count);
        Assert.Equal(2, detail.物料.Count);

        // 已审核不能删
        c.Execute("UPDATE [生产制单] SET [审核]='1' WHERE [生产单号]=@生产单号", new { 生产单号 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(生产单号));

        // 反审核后可删，全部子表清空
        c.Execute("UPDATE [生产制单] SET [审核]='0' WHERE [生产单号]=@生产单号", new { 生产单号 });
        Assert.True(await Svc().DeleteAsync(生产单号));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        Assert.False(await Svc().DeleteAsync("SC不存在"));

        P2TestData.Cleanup(c);
    }

    // 下游单据引用拦截:采购明细挂该生产单 → 删除抛中文提示(409),单头/子表不动
    [SkippableFact]
    public async Task Delete_blocked_by_downstream_purchase_reference()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            c.Execute("INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'PO-DEL-BLK',SYSDATETIME(),N'阻断供应商','0')");
            c.Execute("INSERT INTO [采购明细单]([单号],[物料编号],[生产单号]) VALUES(N'PO-DEL-BLK',N'P2TM01',@生产单号)", new { 生产单号 });

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(生产单号));
            Assert.Contains("采购明细", ex.Message);
            // 单头未动
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PO-DEL-BLK'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PO-DEL-BLK'");
            await Svc().DeleteAsync(生产单号);
            P2TestData.Cleanup(c);
        }
    }

    // 第二个 BOM款号（用于多货号测试）：1 道工序(单价3) + 1 种物料(用量1, 单价5, 复用 P2TM01)
    private const string 款号2 = "P2TK02";

    private static void Seed款号2(SqlConnection c)
    {
        Cleanup款号2(c);
        c.Execute("INSERT INTO [款号总表]([款号],[款式],[单价]) VALUES(N'P2TK02',N'P2测试款式2',80)");
        c.Execute(@"INSERT INTO [款号明细表]([款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                    VALUES(N'P2TK02',N'P2测试款式2',N'01',N'整烫',3.0,N'整烫')");
        c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[单位],[使用数量])
                    VALUES(N'P2TK02',N'P2测试款式2',N'P2TM01',N'P2面料',N'米',1)");
    }

    private static void Cleanup款号2(SqlConnection c)
    {
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [款号]=N'P2TK02'");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [款号]=N'P2TK02'");
        c.Execute("DELETE FROM [生产制单数量] WHERE [款号]=N'P2TK02'");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'P2TK02'");
        c.Execute("DELETE FROM [款号明细表] WHERE [款号]=N'P2TK02'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P2TK02'");
    }

    [SkippableFact]
    public async Task Create_multi_货号_writes_two_货号_rows_with_per_货号_工序_and_BOM()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        Seed款号2(c);

        var dto = new ProductionNoticeCreateDto
        {
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
            货号明细 =
            [
                new ProductionGoodsLineDto
                {
                    货号 = "HH-A", BOM款号 = P2TestData.款号, 款号名称 = "P2测试款式", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 100 } ]
                },
                new ProductionGoodsLineDto
                {
                    货号 = "HH-B", BOM款号 = 款号2, 款号名称 = "P2测试款式2", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "蓝色", 尺码 = "M", 数量 = 50 } ]
                },
            ]
        };

        var 生产单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            // 货号明细 2 行
            Assert.Equal(2, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单货号] WHERE [生产单号]=@生产单号", new { 生产单号 }));
            Assert.Equal(P2TestData.款号, c.ExecuteScalar<string>(
                "SELECT [BOM款号] FROM [生产制单货号] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-A'", new { 生产单号 }));
            Assert.Equal(100m, c.ExecuteScalar<decimal>(
                "SELECT [数量] FROM [生产制单货号] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-A'", new { 生产单号 }));
            Assert.Equal(50m, c.ExecuteScalar<decimal>(
                "SELECT [数量] FROM [生产制单货号] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-B'", new { 生产单号 }));

            // 计划数量 = Σ = 150
            Assert.Equal(150m, c.ExecuteScalar<decimal>(
                "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            // 工序按货号：HH-A 2 道(P2TK01)、HH-B 1 道(P2TK02)；单头工序数=3、工序单价=1.5+2.5+3=7
            Assert.Equal(2, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-A'", new { 生产单号 }));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-B'", new { 生产单号 }));
            Assert.Equal("P2TK02", c.ExecuteScalar<string>(
                "SELECT [款号] FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-B'", new { 生产单号 }));
            Assert.Equal(3m, Convert.ToDecimal(c.ExecuteScalar<object>(
                "SELECT [工序数] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 })));
            Assert.Equal(7.0m, c.ExecuteScalar<decimal>(
                "SELECT [工序单价] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            // 数量按货号
            Assert.Equal("HH-A", c.ExecuteScalar<string>(
                "SELECT [货号] FROM [生产制单数量] WHERE [生产单号]=@生产单号 AND [颜色]=N'黑色'", new { 生产单号 }));
            Assert.Equal("HH-B", c.ExecuteScalar<string>(
                "SELECT [货号] FROM [生产制单数量] WHERE [生产单号]=@生产单号 AND [颜色]=N'蓝色'", new { 生产单号 }));

            // BOM 按货号：HH-A 面料200(2×100)+纽扣50(0.5×100)=金额2010；HH-B 面料50(1×50)×10=500
            // 货号明细行：HH-A 2 行、HH-B 1 行
            Assert.Equal(2, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-A'", new { 生产单号 }));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-B'", new { 生产单号 }));
            Assert.Equal(50m, c.ExecuteScalar<decimal>(
                "SELECT [总数量] FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [货号]=N'HH-B' AND [物料编号]=N'P2TM01'", new { 生产单号 }));
            // 单头物料金额 = 2010 + 500 = 2510
            Assert.Equal(2510m, c.ExecuteScalar<decimal>(
                "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            // GetAsync 返回 2 货号明细行 + 3 工序 + 3 BOM
            var detail = await Svc().GetAsync(生产单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.货号明细.Count);
            Assert.Equal(3, detail.工序.Count);
            Assert.Equal(3, detail.物料.Count);
            Assert.Contains(detail.工序, p => p.货号 == "HH-B" && p.工序名称 == "整烫");

            // Delete 清空货号明细
            Assert.True(await Svc().DeleteAsync(生产单号));
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单货号] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        }
        finally
        {
            await Svc().DeleteAsync(生产单号);
            Cleanup款号2(c);
            P2TestData.Cleanup(c);
        }
    }

    // ===== 档=来料/塑胶：按货号 分组（批量领料按货号挑选应领明细用）=====
    [SkippableFact]
    public async Task IssueBasis_来料_按货号_splits_shared_material_by_货号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P2TestData.Seed(c);
        Seed款号2(c);

        // 两个货号共用同一物料 P2TM01：HH-A(P2TK01,100件→面料200) + HH-B(P2TK02,50件→面料50)
        var dto = new ProductionNoticeCreateDto
        {
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
            货号明细 =
            [
                new ProductionGoodsLineDto
                {
                    货号 = "HH-A", BOM款号 = P2TestData.款号, 款号名称 = "P2测试款式", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 100 } ]
                },
                new ProductionGoodsLineDto
                {
                    货号 = "HH-B", BOM款号 = 款号2, 款号名称 = "P2测试款式2", 比例 = 1m, 分析 = true,
                    数量明细 = [ new ProductionQtyDto { 颜色 = "蓝色", 尺码 = "M", 数量 = 50 } ]
                },
            ]
        };
        var 生产单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            // 默认(按货号=false)：保持原聚合——P2TM01 合 1 行 数量250，货号=MAX="HH-B"(兼容老调用方)
            var agg = await Svc().IssueBasisAsync(生产单号, "来料");
            Assert.Equal(2, agg.Count);
            var agg面料 = Assert.Single(agg, r => r.物料编号 == "P2TM01");
            Assert.Equal(250m, agg面料.数量);
            Assert.Equal("HH-B", agg面料.货号);
            Assert.Equal("HH-B", agg面料.款号);

            // 按货号=true：P2TM01 拆 2 行按货号可区分；排序 货号→物料编号；款号 仍=货号值
            var by货号 = await Svc().IssueBasisAsync(生产单号, "来料", 按货号: true);
            Assert.Equal(3, by货号.Count);
            Assert.Equal(
                [("HH-A", "P2TM01"), ("HH-A", "P2TM02"), ("HH-B", "P2TM01")],
                by货号.Select(r => (r.货号, r.物料编号)).ToList());
            Assert.Equal(200m, by货号[0].数量);
            Assert.Equal(50m, by货号[2].数量);
            Assert.All(by货号, r => Assert.Equal(r.货号, r.款号));
        }
        finally
        {
            await Svc().DeleteAsync(生产单号);
            Cleanup款号2(c);
            P2TestData.Cleanup(c);
        }
    }

    // ===== 档=半成品/成品：按生产单取 半成品仓/成品仓 现存净额（装配部再领料/返工领出用）=====
    private const string P7生产单号 = "P7SC01";

    private static void SeedP7(SqlConnection c)
    {
        CleanupP7(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P7C01',N'P7测试客户')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P7K01',N'P7测试款式')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'P7M1',N'P7半成品料',N'规格A',N'件')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核])
                    VALUES(N'P7SC01',N'P7K01',N'P7测试款式',N'P7C01',N'P7测试客户',100,'1')");
    }

    // FK 顺序：先删单据明细→单头→生产制单→基础资料
    private static void CleanupP7(SqlConnection c)
    {
        foreach (var d in new[] { "半成品领料明细单", "半成品入仓明细单", "成品出仓明细单", "成品入仓明细单", "领料明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P7SC01'");
        c.Execute("DELETE FROM [半成品领料单] WHERE [单号] LIKE N'P7%'");
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号] LIKE N'P7%'");
        c.Execute("DELETE FROM [成品出仓单] WHERE [单号] LIKE N'P7%'");
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号] LIKE N'P7%'");
        c.Execute("DELETE FROM [领料单] WHERE [单号] LIKE N'P7%'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P7SC01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P7M1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P7K01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P7C01'");
    }

    [SkippableFact]
    public async Task IssueBasis_半成品_returns_semi_warehouse_net_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedP7(c);
        try
        {
            // 半成品入仓 100(已审核) − 半成品领料 30(已审核) − 装配部领料单(仓库=半成品仓,未审核但已出 10) = 60
            c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P7SR01',N'半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[仓库],[生产单号],[款号],[货号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                        VALUES(N'P7SR01',N'半成品仓',N'P7SC01',N'P7K01',N'P7K01',N'P7M1',N'P7半成品料',N'规格A',N'黑色',N'件',100)");
            c.Execute("INSERT INTO [半成品领料单]([单号],[仓库],[审核]) VALUES(N'P7SL01',N'半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品领料明细单]([单号],[仓库],[生产单号],[款号],[货号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                        VALUES(N'P7SL01',N'半成品仓',N'P7SC01',N'P7K01',N'P7K01',N'P7M1',N'P7半成品料',N'规格A',N'黑色',N'件',30)");
            c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P7LL01',N'半成品仓','0')");
            c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[已出数量])
                        VALUES(N'P7LL01',N'半成品仓',N'P7SC01',N'P7K01',N'P7M1',N'P7半成品料',N'规格A',N'黑色',N'件',40,10)");

            var rows = await Svc().IssueBasisAsync(P7生产单号, "半成品");
            var r = Assert.Single(rows);
            Assert.Equal(P7生产单号, r.生产单号);
            Assert.Equal("P7K01", r.款号);
            Assert.Equal("P7M1", r.物料编号);
            Assert.Equal(60m, r.数量);   // 100 - 30 - 10
        }
        finally { CleanupP7(c); }
    }

    [SkippableFact]
    public async Task IssueBasis_成品_returns_finished_net_stock_grouped_by_款号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedP7(c);
        try
        {
            // 成品入仓 100(明细行审核) − 成品出仓 25(明细行审核) = 75；行映射 物料编号=款号、单位=个
            c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P7FR01',N'成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[颜色],[数量],[审核])
                        VALUES(N'P7FR01',N'成品仓',N'P7SC01',N'P7K01',N'P7测试款式',N'黑色',100,'1')");
            c.Execute("INSERT INTO [成品出仓单]([单号],[仓库],[审核]) VALUES(N'P7FO01',N'成品仓','1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[颜色],[数量],[审核])
                        VALUES(N'P7FO01',N'成品仓',N'P7SC01',N'P7K01',N'P7测试款式',N'黑色',25,'1')");

            var rows = await Svc().IssueBasisAsync(P7生产单号, "成品");
            var r = Assert.Single(rows);
            Assert.Equal(P7生产单号, r.生产单号);
            Assert.Equal("P7K01", r.款号);
            Assert.Equal("P7K01", r.物料编号);
            Assert.Equal("个", r.单位);
            Assert.Equal(75m, r.数量);

            // 未知 档 保持原样(BOM 口径;本单无 BOM → 空)
            Assert.Empty(await Svc().IssueBasisAsync(P7生产单号, "其他"));
        }
        finally { CleanupP7(c); }
    }
}
