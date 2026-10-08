using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using ErpApi.Integrations.SprayPlan;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticPurchaseOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    // 排产推送在测试环境未配置凭证(整体跳过),传空配置即可
    private PlasticPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(),
        new PaijiPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PaijiPushService>.Instance),
        new SprayPlanPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new SprayPlanOptions()),
            Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<SprayPlanPushService>.Instance),
        new PlasticInventoryService(Factory()));

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("IF NOT EXISTS(SELECT 1 FROM [款号总表] WHERE [款号]=N'K-PO') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K-PO',N'塑胶采购订单测试款')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[日期],[计划数量],[审核]) VALUES(N'PO-MO',N'K-PO','2026-06-29',100,'1')");
        c.Execute("INSERT INTO [生产制单货号]([生产单号],[货号]) VALUES(N'PO-MO',N'H-PO')");
        c.Execute("INSERT INTO [塑胶共用物料表]([塑胶货号],[工模编号],[物料编号],[物料名称],[颜色],[色粉号],[用料名称],[加工内容],[用量],[套数]) VALUES(N'H-PO',N'GM-PO',N'POPM',N'ABS粒',N'黑',N'C1',N'用A',N'移印',2,3)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'POPM',N'ABS粒',N'kg')");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号] IN (N'POSTK1',N'POSTK2')");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'POSTK1',N'POSTK2')");
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [物料编号]=N'POPM'");
        c.Execute("DELETE h FROM [塑胶采购订单] h JOIN [塑胶采购订单明细] d ON d.[单号]=h.[单号] WHERE d.[物料编号]=N'POPM'");
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [客户名称]=N'PO测试客户'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'H-PO'");
        c.Execute("DELETE FROM [塑胶物料设置] WHERE [物料编号]=N'POPM'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'POPM'");
        c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=N'PO-MO'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'PO-MO'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-PO'");
    }

    // 下单损耗：塑胶物料设置.损耗率 随基准行带出(前端默认数量=计划数量×用量×(1+损耗率/100))。
    [SkippableFact]
    public async Task Basis_returns_loss_rate()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            c.Execute("INSERT INTO [塑胶物料设置]([物料编号],[损耗率]) VALUES(N'POPM',6.67)");
            var rows = await Svc().BasisAsync("PO-MO");
            Assert.Equal(6.67m, Assert.Single(rows).损耗率);
        }
        finally { Clean(c); }
    }

    // 用量口径:已审核 BOM(款号物料明细表.使用数量)优先于塑胶共用物料表.用量;BOM 未审核/无该行时回落共用表
    [SkippableFact]
    public async Task Basis_usage_prefers_audited_bom_then_falls_back_to_common_table()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            // 已审核 BOM(款号=货号 H-PO) 使用数量=0.5 → 覆盖共用表 用量=2
            c.Execute("INSERT INTO [款号物料总表]([日期],[款号],[类型],[审核]) VALUES('2026-06-29',N'H-PO',N'明细','1')");
            c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[使用数量]) VALUES(N'H-PO',N'POPM',N'ABS粒',0.5)");
            var b = Assert.Single(await Svc().BasisAsync("PO-MO"));
            Assert.Equal(0.5m, b.用量);
            // BOM 反审核后回落共用表 用量=2
            c.Execute("UPDATE [款号物料总表] SET [审核]='0' WHERE [款号]=N'H-PO'");
            b = Assert.Single(await Svc().BasisAsync("PO-MO"));
            Assert.Equal(2m, b.用量);
        }
        finally
        {
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'H-PO'");
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'H-PO'");
            Clean(c);
        }
    }

    // 原料快照(啤机下单自动扣原料):用料名称→塑胶原料资料;
    // basis 带 原料编号/单件克重/原料库存,创建时存 原料用量KG=数量×单件克重/1000,详情读回快照+实时原料库存
    [SkippableFact]
    public async Task Basis_and_Create_carry_raw_material_snapshot()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            c.Execute("UPDATE [塑胶物料资料] SET [用料名称]=N'用A',[原胶件单净重]=1.6,[出模数]=8 WHERE [物料编号]=N'POPM'");
            c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RM-PO'");
            c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[每包重量]) VALUES(N'RM-PO',N'用A',N'KG',25)");
            // 原料入仓 100KG(已审核)→ 实时原料库存 100
            c.Execute("INSERT INTO [原料入仓单]([单号],[审核]) VALUES(N'PORMLIVE','1')");
            c.Execute("INSERT INTO [原料入仓明细单]([单号],[原料编号],[原料名称],[单位],[数量]) VALUES(N'PORMLIVE',N'RM-PO',N'用A',N'KG',100)");

            var b = Assert.Single(await Svc().BasisAsync("PO-MO"));
            Assert.Equal("RM-PO", b.原料编号);
            Assert.Equal("用A", b.原料名称);
            Assert.Equal(1.6m, b.单件克重);
            Assert.Equal(100m, b.原料库存);
            Assert.Equal(8m, b.出模数);   // 同模分组算啤数用

            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            var d = await Svc().GetAsync(单号);
            Assert.Equal("RM-PO", d!.明细[0].原料编号);
            Assert.Equal("用A", d.明细[0].原料名称);
            Assert.Equal(0.008m, d.明细[0].原料用量KG);   // 5件×1.6g/1000
            Assert.Equal(0.0048m, d.明细[1].原料用量KG);  // 3件×1.6g/1000
            Assert.Equal(100m, d.明细[0].原料库存);

            // 整单更新(数量改 9)时按新数量重算快照
            var dto = MakeDto();
            dto.明细.RemoveAt(1);
            dto.明细[0].数量 = 9;
            Assert.True(await Svc().UpdateAsync(单号, dto, "tester2"));
            var d2 = await Svc().GetAsync(单号);
            Assert.Equal(0.0144m, Assert.Single(d2!.明细).原料用量KG); // 9×1.6/1000
        }
        finally
        {
            c.Execute("DELETE FROM [原料入仓明细单] WHERE [单号]=N'PORMLIVE'");
            c.Execute("DELETE FROM [原料入仓单] WHERE [单号]=N'PORMLIVE'");
            c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RM-PO'");
            Clean(c);
        }
    }

    // 物料资料无用料名称 → 关联不到原料,快照留空
    [SkippableFact]
    public async Task Create_without_raw_material_link_leaves_snapshot_null()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            var l = (await Svc().GetAsync(单号))!.明细[0];
            Assert.Null(l.原料编号);
            Assert.Null(l.原料用量KG);
        }
        finally { Clean(c); }
    }

    // 原料扣减只限啤机单:单头选了加工内容(印喷一次加工/二次加工)不存原料快照——加工的是已啤出的胶件;
    // 改单把加工内容清空(变回啤机单)后快照恢复
    [SkippableFact]
    public async Task Create_skips_raw_material_snapshot_unless_啤机单()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            c.Execute("UPDATE [塑胶物料资料] SET [用料名称]=N'用A',[原胶件单净重]=1.6 WHERE [物料编号]=N'POPM'");
            c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RM-PO'");
            c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[每包重量]) VALUES(N'RM-PO',N'用A',N'KG',25)");

            // 印喷一次加工单(单头有加工内容)→ 不存原料快照
            var dto = MakeDto();
            dto.加工内容 = "印喷";
            var 单号 = await Svc().CreateAsync(dto, "tester");
            var l = (await Svc().GetAsync(单号))!.明细[0];
            Assert.Null(l.原料编号);
            Assert.Null(l.原料名称);
            Assert.Null(l.原料用量KG);

            // 改单清空加工内容(变回啤机单)→ 快照恢复
            dto.加工内容 = null;
            Assert.True(await Svc().UpdateAsync(单号, dto, "tester"));
            var l2 = (await Svc().GetAsync(单号))!.明细[0];
            Assert.Equal("RM-PO", l2.原料编号);
            Assert.Equal("用A", l2.原料名称);
            Assert.Equal(0.008m, l2.原料用量KG); // 5件×1.6g/1000
        }
        finally
        {
            c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RM-PO'");
            Clean(c);
        }
    }

    // MA 门:实单货号关联MA单(款号物料总表.MA货号 非空)后,basis/create 拒绝下单;
    // 已建的未审核单在关联MA后也拒绝 update;清掉关联恢复可下单
    [SkippableFact]
    public async Task Basis_Create_Update_blocked_when_mo_linked_to_ma()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            c.Execute("INSERT INTO [款号物料总表]([日期],[款号],[类型],[审核],[MA货号]) VALUES('2026-06-29',N'H-PO',N'明细','1',N'MA-X')");

            // 已关联MA单:basis 409 / create 400
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().BasisAsync("PO-MO"));
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(MakeDto(), "tester"));

            // 清掉关联:恢复可下单
            c.Execute("UPDATE [款号物料总表] SET [MA货号]=NULL WHERE [款号]=N'H-PO'");
            Assert.Single(await Svc().BasisAsync("PO-MO"));
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");

            // 建单后再关联MA:update 同样被拦
            c.Execute("UPDATE [款号物料总表] SET [MA货号]=N'MA-X' WHERE [款号]=N'H-PO'");
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().UpdateAsync(单号, MakeDto(), "tester"));
        }
        finally
        {
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'H-PO'");
            Clean(c);
        }
    }

    private static PlasticPurchaseOrderCreateDto MakeDto() => new()
    {
        供应商编号 = "S01",
        供应商名称 = "PO测试供应商",
        客户名称 = "PO测试客户",
        明细 =
        {
            new() { 生产单号 = "PO-MO", 款号 = "K-PO", 物料编号 = "POPM", 物料名称 = "ABS粒", 模具编号 = "GM-PO", 用量 = 2, 套数 = 3, 数量 = 5, 颜色 = "黑", 色粉号 = "C1", 用料名称 = "用A", 加工内容 = "移印" },
            new() { 生产单号 = "PO-MO", 款号 = "K-PO", 物料编号 = "POPM", 物料名称 = "ABS粒", 模具编号 = "GM-PO", 用量 = 2, 套数 = 3, 数量 = 3, 颜色 = "黑", 色粉号 = "C1", 用料名称 = "用A", 加工内容 = "移印" },
        }
    };

    // 分析门：生产通知单未审核 → basis 拒绝带料、create 拒绝下单
    [SkippableFact]
    public async Task Basis_and_Create_blocked_when_mo_unapproved()
    {
        using var c = fx.Open(); Seed(c);
        c.Execute("UPDATE [生产制单] SET [审核]='0' WHERE [生产单号]=N'PO-MO'");
        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().BasisAsync("PO-MO"));
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(MakeDto(), "tester"));
        }
        finally { Clean(c); }
    }

    // 可用库存=实时塑胶仓库存(库存引擎聚合)：入仓 500 后 basis 返回 500
    [SkippableFact]
    public async Task Basis_returns_live_available_stock()
    {
        using var c = fx.Open(); Seed(c);
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'PORKLIVE',N'塑胶仓','1')");
        c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'PORKLIVE',N'塑胶仓',N'POPM',N'ABS粒',N'kg',500)");
        try
        {
            var basis = await Svc().BasisAsync("PO-MO");
            var b = Assert.Single(basis);
            Assert.Equal(500m, b.可用库存);
        }
        finally
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'PORKLIVE'");
            c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'PORKLIVE'");
            Clean(c);
        }
    }

    [SkippableFact]
    public async Task Basis_brings_bom_then_Create_then_Get()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var basis = await Svc().BasisAsync("PO-MO");
            var b = Assert.Single(basis);
            Assert.Equal("GM-PO", b.模具编号);
            Assert.Equal(3m, b.套数);
            Assert.Equal("C1", b.色粉号);
            Assert.Equal("K-PO", b.款号);
            Assert.Equal("ABS粒", b.物料名称);
            Assert.Equal("移印", b.加工内容);   // basis 带出 加工内容(BOM/物料资料)

            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("SP", 单号);

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("POPM", d.明细[0].物料编号);
            Assert.Equal("GM-PO", d.明细[0].模具编号);
            Assert.Equal(5m, d.明细[0].数量);
            Assert.Equal("移印", d.明细[0].加工内容);   // 加工内容随单保存
            Assert.Equal(3m, d.明细[1].数量);
        }
        finally { Clean(c); }
    }

    // 喷油供应商(名称含「喷油」)的单头 加工内容 必填；其他供应商可空
    [SkippableFact]
    public async Task Create_spray_supplier_requires_加工内容()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var dto = MakeDto();
            dto.供应商名称 = "PO测试喷油供应商";
            // 喷油供应商不填加工内容 → 拒绝
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));

            // 填了加工内容正常创建,详情可读回单头 加工内容
            dto.加工内容 = "印喷";
            var 单号 = await Svc().CreateAsync(dto, "tester");
            var d = await Svc().GetAsync(单号);
            Assert.Equal("印喷", d!.单头!.加工内容);

            // 非喷油供应商不填加工内容 → 正常创建,单头 加工内容 为空
            var 单号2 = await Svc().CreateAsync(MakeDto(), "tester");
            var d2 = await Svc().GetAsync(单号2);
            Assert.Null(d2!.单头!.加工内容);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("塑胶采购订单", 单号, "tester"));

            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [塑胶采购订单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    // 加工阶段:啤机单(单头无加工内容)入仓产出只进「一次加工」库存;真正一次加工(有加工内容)入仓产出
    // 才进「二次加工」库存。啤机单产出直接下二次加工被拦;库存加工单订购数量不得超过实时库存。
    [SkippableFact]
    public async Task SecondProcessStock_stages_and_validation()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            // 啤机单(单头无加工内容) + 入仓 100
            var 啤机单 = await Svc().CreateAsync(MakeDto(), "tester");
            c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'POSTK1',N'塑胶仓','1')");
            c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[订单单号],[生产单号],[物料编号],[物料名称],[单位],[数量],[颜色])
                        VALUES(N'POSTK1',N'塑胶仓',@no,N'PO-MO',N'POPM',N'ABS粒',N'kg',100,N'黑')", new { no = 啤机单 });

            var 一次库存 = await Svc().SecondProcessStockAsync(null, "一次加工");
            Assert.Contains(一次库存, r => r.物料编号 == "POPM" && r.可用库存 == 100);
            // 需求加工内容:物料资料未填时回落 BOM(塑胶共用物料表.加工内容=移印)
            Assert.Equal("移印", Assert.Single(一次库存, r => r.物料编号 == "POPM").需求加工内容);
            // 物料资料填了优先(选印喷只显示需要印喷的件的数据源)
            c.Execute("UPDATE [塑胶物料资料] SET [加工内容]=N'印喷' WHERE [物料编号]=N'POPM'");
            一次库存 = await Svc().SecondProcessStockAsync(null, "一次加工");
            Assert.Equal("印喷", Assert.Single(一次库存, r => r.物料编号 == "POPM").需求加工内容);
            var 二次库存 = await Svc().SecondProcessStockAsync(null, "二次加工");
            Assert.DoesNotContain(二次库存, r => r.物料编号 == "POPM");

            // 啤机单产出直接下二次加工 → 拦(未完成一次加工入仓)
            var 二次dto = MakeDto();
            二次dto.加工类型 = "二次加工";
            二次dto.加工内容 = "印喷";
            二次dto.库存加工 = true;
            var ex0 = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(二次dto, "tester"));
            Assert.Contains("未完成一次加工入仓", ex0.Message);

            // 完成一次加工(有加工内容,按库存下单 8 ≤ 100 放行)并入仓 50 → 二次加工库存出现
            var 一次dto = MakeDto();
            一次dto.加工内容 = "印喷";
            一次dto.库存加工 = true;
            var 一次单 = await Svc().CreateAsync(一次dto, "tester");
            c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'POSTK2',N'塑胶仓','1')");
            c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[订单单号],[物料编号],[物料名称],[单位],[数量],[颜色],[加工内容])
                        VALUES(N'POSTK2',N'塑胶仓',@no,N'POPM',N'ABS粒',N'kg',50,N'黑',N'印喷')", new { no = 一次单 });

            二次库存 = await Svc().SecondProcessStockAsync(null, "二次加工");
            var row = Assert.Single(二次库存, r => r.物料编号 == "POPM");
            Assert.Equal("印喷", row.已加工工序);
            // 啤机入仓仍在「一次加工」阶段(按物料汇总,库存 150)
            一次库存 = await Svc().SecondProcessStockAsync(null, "一次加工");
            Assert.Contains(一次库存, r => r.物料编号 == "POPM");

            // 现在可以下二次加工(订购 8 ≤ 实时库存 150)
            var 单号 = await Svc().CreateAsync(二次dto, "tester");
            Assert.StartsWith("SP", 单号);

            // 库存加工单超实时库存 → 拦
            var 超 = MakeDto();
            超.加工内容 = "印喷";
            超.库存加工 = true;
            foreach (var l in 超.明细) l.数量 = 99999;
            var ex = await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(超, "tester"));
            Assert.Contains("超过实时库存", ex.Message);
        }
        finally { Clean(c); }
    }

    // 按生产单 BOM 带料的一次/二次加工单(库存加工=false):不看库存、不用等上道入仓也能下(2026-10-08 用户要求);
    // 库存门(需一次加工入仓/订购≤实时库存)只管「按库存选料」的加工单
    [SkippableFact]
    public async Task Create_mo_based_process_orders_need_no_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            // 无任何库存、无一次加工入仓:按生产单带料的二次加工单直接下成功
            var 二次 = MakeDto();
            二次.加工类型 = "二次加工";
            二次.加工内容 = "印喷";
            Assert.StartsWith("SP", await Svc().CreateAsync(二次, "tester"));

            // 一次加工(按单带料)同样无库存可下
            var 一次 = MakeDto();
            一次.加工类型 = "一次加工";
            一次.加工内容 = "印喷";
            Assert.StartsWith("SP", await Svc().CreateAsync(一次, "tester"));
        }
        finally { Clean(c); }
    }

    // 阶段已订(basis):啤机单(单头无加工内容)计入 已订啤机、不计入 已订同工序;
    // 同工序(=本行加工内容)的单才计入 已订同工序——下印喷/移印单不被啤机已订误判重复
    [SkippableFact]
    public async Task Basis_splits_ordered_qty_by_stage()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            // 啤机单(单头无加工内容)订 8 → 已订啤机=8,已订同工序=0(本行加工内容=移印)
            await Svc().CreateAsync(MakeDto(), "tester");
            var b = Assert.Single(await Svc().BasisAsync("PO-MO"));
            Assert.Equal(8m, b.已订数量);
            Assert.Equal(8m, b.已订啤机数量);
            Assert.Equal(0m, b.已订同工序数量);

            // 再下同工序(单头加工内容=移印=本行加工内容)单 8 → 已订同工序=8,已订啤机仍 8,总 16
            var 工序dto = MakeDto();
            工序dto.加工内容 = "移印";
            await Svc().CreateAsync(工序dto, "tester");
            b = Assert.Single(await Svc().BasisAsync("PO-MO"));
            Assert.Equal(16m, b.已订数量);
            Assert.Equal(8m, b.已订啤机数量);
            Assert.Equal(8m, b.已订同工序数量);
        }
        finally { Clean(c); }
    }

    // 按库存加工单:生产单号只是来源追溯(可能是已删除的老单),不走生产通知单审核/MA 门;
    // 非库存加工的普通单引用不存在的生产单仍被拦
    [SkippableFact]
    public async Task Create_stock_process_skips_mo_gate()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open(); Seed(c);
        try
        {
            // 现货 100(无来源订单号,仅增加实时库存)
            c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'POSTK1',N'塑胶仓','1')");
            c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量],[颜色])
                        VALUES(N'POSTK1',N'塑胶仓',N'POPM',N'ABS粒',N'kg',100,N'黑')");

            var dto = MakeDto();
            dto.加工内容 = "印喷";
            dto.库存加工 = true;
            foreach (var l in dto.明细) l.生产单号 = "MO-GONE"; // 不存在的老生产单
            var 单号 = await Svc().CreateAsync(dto, "tester"); // 跳过 MO 门:不再报 生产通知单不存在
            Assert.StartsWith("SP", 单号);

            var dto2 = MakeDto();
            foreach (var l in dto2.明细) l.生产单号 = "MO-GONE";
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto2, "tester"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("塑胶采购订单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Update_unapproved_replaces_lines_approved_blocked()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");

            // 未审核：可改，明细整组替换(2行→1行)，单头同步
            var dto = MakeDto();
            dto.客户名称 = "PO测试客户-改";
            dto.明细.RemoveAt(1);
            dto.明细[0].数量 = 9;
            Assert.True(await Svc().UpdateAsync(单号, dto, "tester2"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("PO测试客户-改", d!.单头!.客户名称);
            Assert.Equal(9m, d.单头.数量);
            var l = Assert.Single(d.明细);
            Assert.Equal(9m, l.数量);

            // 已审核：拒绝修改
            Assert.True(await engine.ApproveAsync("塑胶采购订单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().UpdateAsync(单号, MakeDto(), "tester"));

            // 不存在：false
            Assert.False(await Svc().UpdateAsync("SP-NOPE", MakeDto(), "tester"));
        }
        finally { Clean(c); }
    }
}
