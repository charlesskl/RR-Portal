using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Features.Styles.SemiSetup;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

// 装配BOM 领料展开(GET /styles/{款号}/assembly-issue):半成品行 × 半成品设置明细 → 组成物料,
// 数量=做货数量×BOM行用量(缺省回落定义用量)×组成用量,同物料合并;仓库分类=物料资料→来料,塑胶物料资料→塑胶。
// 另覆盖 单头有效 PO号(待绑定优先,审核绑定后回落 款号物料PO绑定)。
[Collection("db")]
public class StyleAssemblyIssueDbTests(DbFixture fx)
{
    private const string 款号 = P2TestData.款号;   // P2TK01
    private const string MA = "P2TKMA";
    private const string 塑胶件 = "P2PJ01";

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
        c.Execute("DELETE FROM [半成品设置明细] WHERE [头ID] IN (SELECT [ID] FROM [半成品设置] WHERE [货号] IN (@款号,@MA))", new { 款号, MA });
        c.Execute("DELETE FROM [半成品设置] WHERE [货号] IN (@款号,@MA)", new { 款号, MA });
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=@塑胶件", new { 塑胶件 });
        c.Execute("DELETE FROM [款号物料PO绑定] WHERE [款号]=@款号", new { 款号 });
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=@款号", new { 款号 });
        P2TestData.Cleanup(c);
    }

    private async Task SeedSemiDefs(string 货号)
    {
        var semi = new SemiSetupService(Factory());
        // 配件包:用量=做 1 个成品要 2 个;组成=P2TM01×3(来料) + P2PJ01×0.5(塑胶)
        await semi.CreateAsync(new SemiSetupSaveDto(货号, "P2配件包", "半成品", 2,
            [new("P2TM01", "P2面料", null, null, "米", 3), new(塑胶件, "P2塑胶件", null, null, "个", 0.5m)]), "tester");
        // 共用件:组成也有 P2TM01(验证同物料合并)
        await semi.CreateAsync(new SemiSetupSaveDto(货号, "P2共用件", "半成品", 1,
            [new("P2TM01", "P2面料", null, null, "米", 1)]), "tester");
    }

    private static BomSaveDto BomDto(params StyleMaterialDto[] 明细) => new(
        null, null, null, "米", [.. 明细]);

    [SkippableFact]
    public async Task AssemblyIssue_展开合并并分类仓库()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[单位]) VALUES(N'ABS',@塑胶件,N'P2塑胶件',N'个')", new { 塑胶件 });
        await SeedSemiDefs(款号);
        var svc = Svc();
        // BOM 明细:半成品行(用量 1 / 用量缺省) + 普通物料行(不展开)
        await svc.ReplaceMaterialsAsync(款号, BomDto(
            new StyleMaterialDto("P2配件包", "P2配件包", "半成品", null, null, "个", 1),
            new StyleMaterialDto("P2共用件", "P2共用件", "半成品", null, null, "个", null),
            new StyleMaterialDto("P2TM02", "P2纽扣", "纸品", null, null, "粒", 1)));

        var view = await svc.GetAssemblyIssueAsync(款号, 10);

        // P2TM01: 10×1×3(配件包) + 10×1(缺省→定义用量=1)×1(共用件) = 40,来料
        // P2PJ01: 10×1×0.5 = 5,塑胶;P2TM02 非半成品不展开
        Assert.Equal(2, view.行.Count);
        var 来料行 = Assert.Single(view.行, r => r.物料编号 == "P2TM01");
        Assert.Equal(40m, 来料行.数量);
        Assert.Equal("来料", 来料行.仓库);
        var 塑胶行 = Assert.Single(view.行, r => r.物料编号 == 塑胶件);
        Assert.Equal(5m, 塑胶行.数量);
        Assert.Equal("塑胶", 塑胶行.仓库);
        Assert.Empty(view.跳过半成品);
        Cleanup();
    }

    [SkippableFact]
    public async Task AssemblyIssue_半成品定义查询键取台头MA货号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[单位]) VALUES(N'ABS',@塑胶件,N'P2塑胶件',N'个')", new { 塑胶件 });
        await SeedSemiDefs(MA);   // 定义挂在 MA 货号下
        var svc = Svc();
        await svc.ReplaceMaterialsAsync(款号, BomDto(
            new StyleMaterialDto("P2配件包", "P2配件包", "半成品", null, null, "个", 1)) with { MA货号 = MA });

        var view = await svc.GetAssemblyIssueAsync(款号, 4);

        Assert.Equal(2, view.行.Count);
        Assert.Equal(12m, Assert.Single(view.行, r => r.物料编号 == "P2TM01").数量);   // 4×1×3
        Assert.Equal(2m, Assert.Single(view.行, r => r.物料编号 == 塑胶件).数量);       // 4×1×0.5
        Cleanup();
    }

    [SkippableFact]
    public async Task AssemblyIssue_材料列为半成品但无定义的行列入跳过()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        await SeedSemiDefs(款号);
        var svc = Svc();
        // 「幽灵半成品」无定义:跳过校验放行需编号 ∈ 半成品设置.名称,故直接 SQL 塞明细行
        await svc.ReplaceMaterialsAsync(款号, BomDto(
            new StyleMaterialDto("P2配件包", "P2配件包", "半成品", null, null, "个", 1)));
        c.Execute(@"
INSERT INTO [款号物料明细表]([日期],[顺序],[款号],[款式],[物料编号],[物料名称],[物料类别],[单位],[使用数量])
VALUES(GETDATE(),99,@款号,N'P2测试款式',N'幽灵半成品',N'幽灵半成品',N'半成品',N'个',1);", new { 款号 });

        var view = await svc.GetAssemblyIssueAsync(款号, 1);

        Assert.Single(view.行, r => r.物料编号 == "P2TM01");
        var skipped = Assert.Single(view.跳过半成品);
        Assert.Equal("幽灵半成品", skipped);
        Cleanup();
    }

    [SkippableFact]
    public async Task MaterialsView_单头PO号_待绑定优先_审核绑定后回落最近绑定()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using var c = fx.Open();
        P2TestData.Seed(c);
        var svc = Svc();
        await svc.ReplaceMaterialsAsync(款号, BomDto(
            new StyleMaterialDto("P2TM01", "P2面料", null, null, null, "米", 2)) with { 待绑定PO号 = "P2PO001" });

        // 待绑定阶段:单头 PO号=待绑定
        var view1 = await svc.GetMaterialsViewAsync(款号);
        Assert.Equal("P2PO001", view1!.单头!.PO号);

        // BOM 审核 → 自动绑定并清空待绑定;单头 PO号 回落最近绑定
        await svc.BomSetAuditAsync(款号, true, "tester");
        var view2 = await svc.GetMaterialsViewAsync(款号);
        Assert.Equal("P2PO001", view2!.单头!.PO号);
        Cleanup();
    }
}
