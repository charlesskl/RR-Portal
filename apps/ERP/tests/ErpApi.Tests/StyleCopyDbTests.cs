using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class StyleCopyDbTests(DbFixture fx)
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
        c.Execute("DELETE FROM [装配物料报价] WHERE [产品货号] IN ('BOMCSRC','BOMCDST')");
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] IN ('BOMCSRC','BOMCDST')");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号] IN ('BOMCSRC','BOMCDST')");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] IN ('BOMCSRC','BOMCDST')");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] IN ('BOMCSRC','BOMCDST')");
        // 物料编号 有 FK→物料资料；客户编号 有 FK→客户资料(FK_129 经 款号物料总表)；明细删净后再删父
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN ('M1','M2')");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='C001'");
    }

    private void Seed()
    {
        using var c = fx.Open();
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'BOMCSRC',N'复制源款')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'BOMCDST',N'复制目标款')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M1',N'面料')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'M2',N'纽扣')");
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'C001',N'测试客户')");
    }

    private static BomSaveDto SourceBom() => new(
        "C001", "测试客户", new DateTime(2026, 7, 28), "PCS",
        [
            new StyleMaterialDto("M1", "面料", "主料", "1.5m", "黑色", "米", 2m),
            new StyleMaterialDto("M2", "纽扣", "辅料", "12mm", "白色", null, 3m),
        ]);

    [SkippableFact]
    public async Task CopyMaterials_正常复制到空目标()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        Seed();
        var svc = Svc();
        await svc.ReplaceMaterialsAsync("BOMCSRC", SourceBom());

        await svc.CopyMaterialsAsync("BOMCSRC", "BOMCDST", 覆盖: false);

        var view = await svc.GetMaterialsViewAsync("BOMCDST");
        Assert.NotNull(view);
        Assert.Equal(2, view!.物料.Count);
        var m1 = view.物料.Single(x => x.物料编号 == "M1");
        var m2 = view.物料.Single(x => x.物料编号 == "M2");
        Assert.Equal(2m, m1.使用数量);
        Assert.Equal(3m, m2.使用数量);
        Assert.Equal("主料", m1.物料类别);
        // 目标行落目标款号/款式；客户编号随行复制；行单位优先、缺省回退单头单位
        Assert.Equal("BOMCDST", m1.款号);
        Assert.Equal("复制目标款", m1.款式);
        Assert.Equal("C001", m1.客户编号);
        Assert.Equal("米", m1.单位);
        Assert.Equal("PCS", m2.单位);
        // 源不受影响
        var source = await svc.GetMaterialsViewAsync("BOMCSRC");
        Assert.Equal(2, source!.物料.Count);

        Cleanup();
    }

    [SkippableFact]
    public async Task CopyMaterials_目标已有BOM且未覆盖_抛冲突()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        Seed();
        var svc = Svc();
        await svc.ReplaceMaterialsAsync("BOMCSRC", SourceBom());
        await svc.ReplaceMaterialsAsync("BOMCDST", new BomSaveDto(
            null, null, null, null,
            [new StyleMaterialDto("M1", "面料", "主料", null, null, "米", 9m)]));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyMaterialsAsync("BOMCSRC", "BOMCDST", 覆盖: false));
        Assert.Contains("已有 BOM", ex.Message);

        // 目标保持原样（未被复制改动）
        var view = await svc.GetMaterialsViewAsync("BOMCDST");
        Assert.Single(view!.物料);
        Assert.Equal(9m, view.物料[0].使用数量);

        Cleanup();
    }

    [SkippableFact]
    public async Task CopyMaterials_覆盖true_整组替换目标()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        Seed();
        var svc = Svc();
        await svc.ReplaceMaterialsAsync("BOMCSRC", SourceBom());
        await svc.ReplaceMaterialsAsync("BOMCDST", new BomSaveDto(
            null, null, null, null,
            [new StyleMaterialDto("M1", "面料", "主料", null, null, "米", 9m)]));

        await svc.CopyMaterialsAsync("BOMCSRC", "BOMCDST", 覆盖: true);

        var view = await svc.GetMaterialsViewAsync("BOMCDST");
        Assert.Equal(2, view!.物料.Count);
        Assert.Equal(2m, view.物料.Single(x => x.物料编号 == "M1").使用数量);

        Cleanup();
    }

    [SkippableFact]
    public async Task CopyMaterials_源无BOM或源不存在_报错()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        Seed();
        var svc = Svc();

        // 源款号存在但无 BOM 明细
        var ex1 = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyMaterialsAsync("BOMCSRC", "BOMCDST", 覆盖: false));
        Assert.Contains("无法复制", ex1.Message);

        // 源款号不存在
        var ex2 = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyMaterialsAsync("不存在的款号XX", "BOMCDST", 覆盖: false));
        Assert.Contains("不存在", ex2.Message);

        Cleanup();
    }
}
