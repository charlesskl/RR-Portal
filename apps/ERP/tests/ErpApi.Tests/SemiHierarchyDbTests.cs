using Dapper;
using ErpApi.Data;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

// 多层级半成品（DB 集成；未设置 ERP_TEST_DB 时自动跳过）：
// 1) 保存 BOM 既调半成品又直接列其组成物料 → 返回重复扣料警告；
// 2) 生产制单算法4 对半成品行递归展开，按半成品 BOM 计物料需求，半成品行本身不产生需求行。
[Collection("db")]
public sealed class SemiHierarchyDbTests(DbFixture fx)
{
    private const string 成品款号 = "SH-FIN";
    private const string 半成品款号 = "SH-SEM";
    private const string 物料编号 = "SH-MAT-1";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private StyleService Style() => new(Factory(), new ErpDbContext(
        new DbContextOptionsBuilder<ErpDbContext>().UseSqlServer(fx.ConnectionString!).Options));

    private ProductionService Production() =>
        new(Factory(), new DocumentNumberGenerator(),
            new ErpApi.Engines.Inventory.MaterialInventoryService(Factory()));

    private void Seed()
    {
        using var c = fx.Open();
        Cleanup();
        // FK 父行：款号物料明细表.物料编号→物料资料(FK_133，半成品行编号即款号)，
        // 生产制单.客户编号→客户资料(FK_143)、.加工厂编号→加工厂资料(FK_142)
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'SH-C01',N'SH测试客户')");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'SH-F01',N'SH测试加工厂')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'SH-MAT-1',N'SH测试物料',N'个',5)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'SH-SEM',N'SH半成品',N'个')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'SH-SEM',N'SH半成品'),(N'SH-FIN',N'SH成品')");
        // 半成品判定集：SH-SEM 已在 半成品共用物料设置 中设置
        c.Execute("INSERT INTO [半成品共用物料设置]([产品货号],[类别]) VALUES(N'SH-SEM',N'半成品')");
        // 半成品自己的 BOM：SH-MAT-1 × 3
        c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[单位],[使用数量])
                    VALUES(N'SH-SEM',N'SH半成品',N'SH-MAT-1',N'SH测试物料',N'个',3)");

        // === 新模型(半成品设置):BOM 行 物料编号=半成品设置.名称,组成在 半成品设置明细 ===
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'SH2-MAT-1',N'SH2物料一',N'个',4),(N'SH2-MAT-2',N'SH2物料二',N'个',0.5)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'SH2-配件包',N'SH2配件包',N'个')"); // FK_133 父行
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'SH2-FIN',N'SH2成品')");
        // 同名半成品两个货号各有一份:先插 OTHER(更早 ID),验证展开优先取与根 BOM 同货号的设置
        c.Execute("INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[用量],[操作员]) VALUES(N'OTHER',N'SH2-配件包',N'半成品',1,1,N't')");
        c.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                    SELECT [ID],N'SH2-MAT-1',N'SH2物料一',N'个',99 FROM [半成品设置] WHERE [货号]=N'OTHER' AND [名称]=N'SH2-配件包'");
        c.Execute("INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[用量],[操作员]) VALUES(N'SH2-FIN',N'SH2-配件包',N'半成品',1,1,N't')");
        // 明细:SH2-MAT-1 使用数量 NULL(按 1 计) + SH2-MAT-2 × 3
        c.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                    SELECT [ID],N'SH2-MAT-1',N'SH2物料一',N'个',NULL FROM [半成品设置] WHERE [货号]=N'SH2-FIN' AND [名称]=N'SH2-配件包'");
        c.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                    SELECT [ID],N'SH2-MAT-2',N'SH2物料二',N'个',3 FROM [半成品设置] WHERE [货号]=N'SH2-FIN' AND [名称]=N'SH2-配件包'");
        // 成品 BOM:调入半成品 SH2-配件包 × 2(物料类别=半成品,与 92125-MA 同款写法) + 直接物料 SH2-MAT-3 × 5
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'SH2-MAT-3',N'SH2直接物料',N'个',2)");
        c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[物料类别],[单位],[使用数量])
                    VALUES(N'SH2-FIN',N'SH2成品',N'SH2-配件包',N'SH2配件包',N'半成品',N'个',2),
                          (N'SH2-FIN',N'SH2成品',N'SH2-MAT-3',N'SH2直接物料',N'辅料',N'个',5)");
    }

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [半成品设置明细] WHERE [头ID] IN (SELECT [ID] FROM [半成品设置] WHERE [名称] IN (N'SH2-配件包',N'SH2-内芯'))");
        c.Execute("DELETE FROM [半成品设置] WHERE [名称] IN (N'SH2-配件包',N'SH2-内芯')");
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [生产制单数量] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [生产制单货号] WHERE [BOM款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [生产制单] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] IN (N'SH-FIN',N'SH-SEM')");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] IN (N'SH-FIN',N'SH-SEM',N'SH2-FIN')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'SH-MAT-1',N'SH-SEM',N'SH2-MAT-1',N'SH2-MAT-2',N'SH2-MAT-3',N'SH2-MAT-4',N'SH2-配件包',N'SH2-内芯')");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'SH-C01'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'SH-F01'");
    }

    [SkippableFact]
    public async Task ReplaceMaterials_warns_when_bom_pulls_semi_and_its_component_material()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            // 成品 BOM：调入半成品 SH-SEM，同时又直接列了它的组成物料 SH-MAT-1
            var dto = new BomSaveDto(null, null, null, null,
            [
                new StyleMaterialDto(半成品款号, "SH半成品", null, null, null, "个", 1),
                new StyleMaterialDto(物料编号, "SH测试物料", null, null, null, "个", 1),
            ]);

            var 警告 = await Style().ReplaceMaterialsAsync(成品款号, dto);

            var warning = Assert.Single(警告);
            Assert.Contains(物料编号, warning);
            Assert.Contains(半成品款号, warning);
        }
        finally { Cleanup(); }
    }

    [SkippableFact]
    public async Task ReplaceMaterials_no_warning_when_bom_only_pulls_semi()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            var dto = new BomSaveDto(null, null, null, null,
                [new StyleMaterialDto(半成品款号, "SH半成品", null, null, null, "个", 2)]);

            var 警告 = await Style().ReplaceMaterialsAsync(成品款号, dto);

            Assert.Empty(警告);
        }
        finally { Cleanup(); }
    }

    [SkippableFact]
    public async Task Create_production_recursively_expands_semi_rows_算法4()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            // 成品 BOM：只调入半成品 SH-SEM × 2（不直接列物料）
            await Style().ReplaceMaterialsAsync(成品款号, new BomSaveDto(null, null, null, null,
                [new StyleMaterialDto(半成品款号, "SH半成品", null, null, null, "个", 2)]));

            var 生产单号 = await Production().CreateAsync(new ProductionNoticeCreateDto
            {
                客户编号 = "SH-C01", 客户名称 = "SH测试客户",
                加工厂编号 = "SH-F01", 加工厂名称 = "SH测试加工厂",
                货号明细 =
                [
                    new ProductionGoodsLineDto
                    {
                        货号 = "SH-HH1", BOM款号 = 成品款号, 款号名称 = "SH成品", 比例 = 1m, 分析 = true,
                        数量明细 = [new ProductionQtyDto { 颜色 = "黑", 尺码 = "S", 数量 = 10 }]
                    }
                ]
            }, "tester");

            using var c = fx.Open();
            // 半成品行被递归替换：SH-MAT-1 需求 = 2(半成品用量) × 3(半成品 BOM 用量) × 10(计划数量) = 60
            var row = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH-MAT-1'",
                new { 生产单号 });
            Assert.Equal(60m, (decimal)row.总数量);
            Assert.Equal(300m, (decimal)row.金额);   // 60 × 单价5
            // 半成品行本身不产生物料需求行（防止重复扣料）
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH-SEM'",
                new { 生产单号 }));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号",
                new { 生产单号 }));
            Assert.Equal(300m, c.ExecuteScalar<decimal>(
                "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            Assert.True(await Production().DeleteAsync(生产单号));
        }
        finally { Cleanup(); }
    }

    // 新模型(半成品设置):BOM 半成品行按组成展开计入需求(数量=BOM行使用数量×组成使用数量,同物料合并),
    // 本 BOM 直接物料若被组成覆盖则剔除(防 明细+半成品组成 双源重复下单);半成品行本身不进物料清单
    [SkippableFact]
    public async Task Create_production_expands_半成品设置组成_并剔除明细重复()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            var 生产单号 = await Production().CreateAsync(new ProductionNoticeCreateDto
            {
                客户编号 = "SH-C01", 客户名称 = "SH测试客户",
                加工厂编号 = "SH-F01", 加工厂名称 = "SH测试加工厂",
                货号明细 =
                [
                    new ProductionGoodsLineDto
                    {
                        货号 = "SH2-HH1", BOM款号 = "SH2-FIN", 款号名称 = "SH2成品", 比例 = 1m, 分析 = true,
                        数量明细 = [new ProductionQtyDto { 颜色 = "黑", 尺码 = "S", 数量 = 10 }]
                    }
                ]
            }, "tester");

            using var c = fx.Open();
            // 组成展开(定义取与根 BOM 同货号 SH2-FIN 的设置,不取 OTHER 货号的 ×99 版本):
            // SH2-MAT-1 = 10 × 2(配件包用量) × 1(NULL 按 1 计) = 20,金额=20×4=80
            var m1 = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-1'",
                new { 生产单号 });
            Assert.Equal(20m, (decimal)m1.总数量);
            Assert.Equal(80m, (decimal)m1.金额);
            // SH2-MAT-2 = 10 × 2 × 3 = 60,金额=60×0.5=30
            var m2 = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-2'",
                new { 生产单号 });
            Assert.Equal(60m, (decimal)m2.总数量);
            Assert.Equal(30m, (decimal)m2.金额);
            // 直接物料 SH2-MAT-3: 10 × 5 = 50,金额=50×2=100(未被组成覆盖,保留)
            var m3 = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-3'",
                new { 生产单号 });
            Assert.Equal(50m, (decimal)m3.总数量);
            Assert.Equal(100m, (decimal)m3.金额);
            // 半成品行本身不进物料清单;展开后共 3 行;物料金额=80+30+100=210
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-配件包'",
                new { 生产单号 }));
            Assert.Equal(3, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号",
                new { 生产单号 }));
            Assert.Equal(210m, c.ExecuteScalar<decimal>(
                "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            Assert.True(await Production().DeleteAsync(生产单号));
        }
        finally { Cleanup(); }
    }

    // 数量进一法:用量为小数时 需求/需订 向上取整(只多不少);金额按整数需求算
    [SkippableFact]
    public async Task Create_production_rounds_quantities_up_to_integer()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            using (var c0 = fx.Open())
            {
                c0.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'SH2-MAT-4',N'SH2物料四',N'个',2)");
                // 小数用量直接物料:0.333 × 10 = 3.33 → 进一 4
                c0.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[物料类别],[单位],[使用数量])
                            VALUES(N'SH2-FIN',N'SH2成品',N'SH2-MAT-4',N'SH2物料四',N'辅料',N'个',0.333)");
            }
            var 生产单号 = await Production().CreateAsync(new ProductionNoticeCreateDto
            {
                客户编号 = "SH-C01", 客户名称 = "SH测试客户",
                加工厂编号 = "SH-F01", 加工厂名称 = "SH测试加工厂",
                货号明细 =
                [
                    new ProductionGoodsLineDto
                    {
                        货号 = "SH2-HH3", BOM款号 = "SH2-FIN", 款号名称 = "SH2成品", 比例 = 1m, 分析 = true,
                        数量明细 = [new ProductionQtyDto { 颜色 = "黑", 尺码 = "S", 数量 = 10 }]
                    }
                ]
            }, "tester");

            using var c = fx.Open();
            var m4 = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-4'",
                new { 生产单号 });
            Assert.Equal(4m, (decimal)m4.总数量);   // ceil(3.33)
            Assert.Equal(4m, (decimal)m4.需订数量);
            Assert.Equal(8m, (decimal)m4.金额);     // 4 × 单价2
            // 整数行不受影响:MAT-1=20 / MAT-2=60 / MAT-3=50
            Assert.Equal(20m, c.ExecuteScalar<decimal>(
                "SELECT [总数量] FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-1'", new { 生产单号 }));
            Assert.True(await Production().DeleteAsync(生产单号));
        }
        finally { Cleanup(); }
    }

    // 嵌套半成品(3级+):配件包组成里再含半成品内芯 → 递归展开、用量逐层相乘;
    // 内芯反引配件包构成环时,环上停止(警告)不死循环,已展开层级照常计入
    [SkippableFact]
    public async Task Create_production_expands_nested_半成品组成_recursively()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Seed();
        try
        {
            using (var c0 = fx.Open())
            {
                // 3级:配件包 组成 + 内芯×2;内芯 组成 = SH2-MAT-4 ×5;再反引配件包(×7)构成环
                c0.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'SH2-MAT-4',N'SH2物料四',N'个',2),(N'SH2-内芯',N'SH2内芯',N'个',NULL)");
                c0.Execute("INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[用量],[操作员]) VALUES(N'SH2-FIN',N'SH2-内芯',N'半成品',2,1,N't')");
                c0.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                            SELECT [ID],N'SH2-内芯',N'SH2内芯',N'个',2 FROM [半成品设置] WHERE [货号]=N'SH2-FIN' AND [名称]=N'SH2-配件包'");
                c0.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                            SELECT [ID],N'SH2-MAT-4',N'SH2物料四',N'个',5 FROM [半成品设置] WHERE [货号]=N'SH2-FIN' AND [名称]=N'SH2-内芯'");
                c0.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量])
                            SELECT [ID],N'SH2-配件包',N'SH2配件包',N'个',7 FROM [半成品设置] WHERE [货号]=N'SH2-FIN' AND [名称]=N'SH2-内芯'");
            }

            var 生产单号 = await Production().CreateAsync(new ProductionNoticeCreateDto
            {
                客户编号 = "SH-C01", 客户名称 = "SH测试客户",
                加工厂编号 = "SH-F01", 加工厂名称 = "SH测试加工厂",
                货号明细 =
                [
                    new ProductionGoodsLineDto
                    {
                        货号 = "SH2-HH2", BOM款号 = "SH2-FIN", 款号名称 = "SH2成品", 比例 = 1m, 分析 = true,
                        数量明细 = [new ProductionQtyDto { 颜色 = "黑", 尺码 = "S", 数量 = 10 }]
                    }
                ]
            }, "tester");

            using var c = fx.Open();
            // 递归:SH2-MAT-4 = 10(计划) × 2(配件包) × 2(内芯) × 5 = 200,金额=200×2=400
            var m4 = c.QueryFirst(
                "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-4'",
                new { 生产单号 });
            Assert.Equal(200m, (decimal)m4.总数量);
            Assert.Equal(400m, (decimal)m4.金额);
            // 单层部分不变:MAT-1=20 / MAT-2=60 / MAT-3=50
            Assert.Equal(20m, c.ExecuteScalar<decimal>(
                "SELECT [总数量] FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-1'", new { 生产单号 }));
            Assert.Equal(60m, c.ExecuteScalar<decimal>(
                "SELECT [总数量] FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-2'", new { 生产单号 }));
            Assert.Equal(50m, c.ExecuteScalar<decimal>(
                "SELECT [总数量] FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'SH2-MAT-3'", new { 生产单号 }));
            // 半成品(含嵌套层与环上的反引)本身不产生物料行
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号] IN (N'SH2-配件包',N'SH2-内芯')",
                new { 生产单号 }));
            // 共 4 行;物料金额=80+30+100+400=610
            Assert.Equal(4, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
            Assert.Equal(610m, c.ExecuteScalar<decimal>(
                "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

            Assert.True(await Production().DeleteAsync(生产单号));
        }
        finally { Cleanup(); }
    }
}
