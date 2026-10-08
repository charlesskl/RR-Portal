using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class StyleMaterialsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Svc() => new(Factory(), Ctx());

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]='BOMK1'");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]='BOMK1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='BOMK1'");
        // 物料编号 有 FK→物料资料；客户编号 有 FK→客户资料；明细删净后再删父
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN ('M1','M2')");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='C001'");
    }

    [SkippableFact]
    public async Task ReplaceMaterials_整组替换_then_get_full()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using (var c = fx.Open())
        {
            c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'BOMK1',N'BOM测试款')");
            // 款号物料明细表.物料编号 FK→物料资料.物料编号，需先建父行
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M1',N'面料')");
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M2',N'纽扣')");
            // 客户编号 FK→客户资料，需先建父行
            c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'C001',N'测试客户')");
        }

        var svc = Svc();
        await svc.ReplaceMaterialsAsync("BOMK1", new BomSaveDto(
            "C001", "测试客户", new DateTime(2026, 6, 5), "PCS",
            [
                // 第二行单位留空 → 应回退单头单位 PCS
                new StyleMaterialDto("M1", "面料", "主料", "1.5m", "黑色", "米", 2m),
                new StyleMaterialDto("M2", "纽扣", "辅料", "12mm", "白色", null, 3m),
            ]));

        var full = await svc.GetFullAsync("BOMK1");
        Assert.NotNull(full);
        Assert.Equal("BOM测试款", full!.主档.款式);
        Assert.Equal(2, full.物料.Count);
        var m1 = full.物料.Single(x => x.物料编号 == "M1");
        var m2 = full.物料.Single(x => x.物料编号 == "M2");
        Assert.Equal(2m, m1.使用数量);
        Assert.Equal(3m, m2.使用数量);
        Assert.Equal("主料", m1.物料类别);
        Assert.Equal("BOM测试款", m1.款式);
        // 单头逐行落库：客户编号持久化；行单位优先、缺省回退单头单位
        Assert.Equal("C001", m1.客户编号);
        Assert.Equal("米", m1.单位);
        Assert.Equal("PCS", m2.单位);

        // 再次替换 1 行 = 覆盖（整组替换，不是追加）
        await svc.ReplaceMaterialsAsync("BOMK1", new BomSaveDto(
            null, null, null, null,
            [new StyleMaterialDto("M1", "面料", "主料", null, null, "米", 5m)]));
        full = await svc.GetFullAsync("BOMK1");
        Assert.Single(full!.物料);
        Assert.Equal(5m, full.物料[0].使用数量);

        Cleanup();
    }

    [SkippableFact]
    public async Task ReplaceMaterials_新款号自动建档到款号总表()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string 款号 = "BOMK-NEW1";
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN ('M1','M2')");
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M1',N'面料')");
        }
        try
        {
            // 款号不存在于 款号总表 → 保存 BOM 时自动建档(款式取载荷里的 款式),不再抛错
            await Svc().ReplaceMaterialsAsync(款号, new BomSaveDto(
                null, null, null, "PCS",
                [new StyleMaterialDto("M1", "面料", null, null, null, null, 1m)],
                款式: "自动建档测试款"));

            using (var c = fx.Open())
            {
                var 款式 = c.ExecuteScalar<string?>(
                    "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
                Assert.Equal("自动建档测试款", 款式);
            }
            var full = await Svc().GetFullAsync(款号);
            Assert.NotNull(full);
            Assert.Single(full!.物料);
            Assert.Equal("自动建档测试款", full.物料[0].款式);
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN ('M1','M2')");
        }
    }

    // MA/实单 双版本共用夹具：MA 模板货号 + 实单货号 + 一条物料档案 + MA 的半成品/包装定义
    private const string MaNo = "BOMK-MA1";
    private const string SoNo = "BOMK-SO1";
    private const string SemiDefName = "BOMK-SEMI组";
    private const string PackDefName = "BOMK-彩盒包装";

    private void MaCleanup()
    {
        using var c = fx.Open();
        foreach (var 款号 in new[] { MaNo, SoNo })
        {
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute(@"DELETE d FROM [半成品设置明细] d
JOIN [半成品设置] h ON h.[ID]=d.[头ID] WHERE h.[货号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [半成品设置] WHERE [货号]=@款号", new { 款号 });
        }
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='M1'");
    }

    private void MaSetup()
    {
        MaCleanup();
        using var c = fx.Open();
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M1',N'面料')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'BOMK-MA1',N'MA模板款')");
        // MA 货号的半成品/包装定义(实单勾选来源;定义名称不在物料档案)
        c.Execute(@"INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序]) VALUES(N'BOMK-MA1',N'BOMK-SEMI组',N'半成品',1);
DECLARE @h1 bigint = SCOPE_IDENTITY();
INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[使用数量]) VALUES(@h1,N'M1',N'面料',2);
INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序]) VALUES(N'BOMK-MA1',N'BOMK-彩盒包装',N'包装',2);
DECLARE @h2 bigint = SCOPE_IDENTITY();
INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[使用数量]) VALUES(@h2,N'M1',N'面料',1);");
    }

    [SkippableFact]
    public async Task ReplaceMaterials_MA货号落库可读回_再存null清掉()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        MaSetup();
        try
        {
            var svc = Svc();
            await svc.ReplaceMaterialsAsync(SoNo, new BomSaveDto(
                null, null, null, "PCS",
                [new StyleMaterialDto("M1", "面料", null, null, null, null, 1m)],
                款式: "实单测试款", MA货号: MaNo));

            var view = await svc.GetMaterialsViewAsync(SoNo);
            Assert.NotNull(view?.单头);
            Assert.Equal(MaNo, view!.单头!.MA货号);

            // 再保存 MA货号=null（MA 版/解除关联）→ 台头 MA货号 清掉
            await svc.ReplaceMaterialsAsync(SoNo, new BomSaveDto(
                null, null, null, "PCS",
                [new StyleMaterialDto("M1", "面料", null, null, null, null, 1m)]));
            view = await svc.GetMaterialsViewAsync(SoNo);
            Assert.Null(view!.单头!.MA货号);
        }
        finally { MaCleanup(); }
    }

    [SkippableFact]
    public async Task ReplaceMaterials_实单可引用MA的半成品包装定义名称_不被物料编号校验拦截()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        MaSetup();
        try
        {
            // 实单 BOM 行：普通物料 M1 + MA 的半成品定义行 + MA 的包装定义行(编号=定义名称,不在物料档案)
            await Svc().ReplaceMaterialsAsync(SoNo, new BomSaveDto(
                null, null, null, "PCS",
                [
                    new StyleMaterialDto("M1", "面料", "主料", null, null, null, 2m),
                    new StyleMaterialDto(SemiDefName, SemiDefName, "半成品", null, null, "PCS", 1m),
                    new StyleMaterialDto(PackDefName, PackDefName, "包装", null, null, "PCS", 1m),
                ],
                款式: "实单测试款", MA货号: MaNo));

            var view = await Svc().GetMaterialsViewAsync(SoNo);
            Assert.Equal(3, view!.物料.Count);
            Assert.Contains(view.物料, m => m.物料编号 == SemiDefName && m.物料类别 == "半成品");
            Assert.Contains(view.物料, m => m.物料编号 == PackDefName && m.物料类别 == "包装");
            Assert.Equal(MaNo, view.单头!.MA货号);
        }
        finally { MaCleanup(); }
    }

    [SkippableFact]
    public async Task ReplaceMaterials_编号不在物料资料也不在任何定义名称里仍报错()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        MaSetup();
        try
        {
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc().ReplaceMaterialsAsync(SoNo, new BomSaveDto(
                    null, null, null, "PCS",
                    [new StyleMaterialDto("NOPE-X", "不存在物料", null, null, null, null, 1m)],
                    款式: "实单测试款", MA货号: MaNo)));
            Assert.Contains("物料编号不存在", ex.Message);
            Assert.Contains("NOPE-X", ex.Message);
        }
        finally { MaCleanup(); }
    }

    // 回归:主档 物料资料/塑胶物料资料.备注 是 nvarchar(max),长备注带进 BOM 保存曾撞
    // 款号物料明细表.备注 nvarchar(20) 截断(2628);db/114 加宽至 200 后须完整落库。
    [SkippableFact]
    public async Task ReplaceMaterials_长备注超20字完整保存()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string 款号 = "BOMK-LONGREMARK";
        const string 长备注 = "材料:128g可移贴+冷烫镭射+局部无胶工艺"; // 32 字,与塑胶 57001539 同量级
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='M-LONG'");
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M-LONG',N'长备注料')");
        }
        try
        {
            var svc = Svc();
            await svc.ReplaceMaterialsAsync(款号, new BomSaveDto(
                null, null, null, "个",
                [new StyleMaterialDto("M-LONG", "长备注料", null, null, null, null, 1m, 备注: 长备注)],
                款式: "长备注测试款"));
            var full = await svc.GetFullAsync(款号);
            Assert.NotNull(full);
            Assert.Equal(长备注, full!.物料.Single(m => m.物料编号 == "M-LONG").备注);
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='M-LONG'");
        }
    }

    // 回归:BOM 页产品名称可编辑,但老货号保存时后端曾只用款号总表现值、忽略提交的产品名称,
    // 保存后重载名称被还原(表现为"输入了却不显示")。修复后:非空款式同步更新款号总表;传空不抹掉。
    [SkippableFact]
    public async Task ReplaceMaterials_老货号保存同步更新款号总表款式()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string 款号 = "BOMK-REN1";
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='M1'");
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M1',N'面料')");
            c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(@款号,N'旧名字')", new { 款号 });
        }
        try
        {
            var svc = Svc();
            await svc.ReplaceMaterialsAsync(款号, new BomSaveDto(
                null, null, null, "个",
                [new StyleMaterialDto("M1", "面料", null, null, null, null, 1m)],
                款式: "新名字"));

            using (var c = fx.Open())
            {
                var 款式 = c.ExecuteScalar<string?>(
                    "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
                Assert.Equal("新名字", 款式);
            }
            var full = await svc.GetFullAsync(款号);
            Assert.Equal("新名字", full!.主档.款式);
            Assert.Equal("新名字", full.物料[0].款式);

            // 再保存不传款式 → 不抹掉已更新的名称
            await svc.ReplaceMaterialsAsync(款号, new BomSaveDto(
                null, null, null, "个",
                [new StyleMaterialDto("M1", "面料", null, null, null, null, 1m)]));
            full = await svc.GetFullAsync(款号);
            Assert.Equal("新名字", full!.主档.款式);
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=@款号", new { 款号 });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='M1'");
        }
    }
}
