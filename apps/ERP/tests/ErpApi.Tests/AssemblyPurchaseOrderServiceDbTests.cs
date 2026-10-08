using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Assembly;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AssemblyPurchaseOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private AssemblyPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 模拟旧版语义: 款号BOM(款号物料明细表)是当前物料来源
    private static void SeedBom(SqlConnection c)
    {
        Clean(c);
        // 款号物料明细表.物料编号 有 FK 指向 物料资料,需先落主档
        foreach (var (code, name) in new[] { ("ZPM1", "纸箱"), ("ZPM2", "胶袋"), ("ZPM3", "新料") })
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(@code,@name,N'个')", new { code, name });
        c.Execute("INSERT INTO [款号物料总表]([款号],[款式],[日期],[使用数量],[审核]) VALUES(N'K-ZP',N'装配采购单测试款','2026-07-28',100,N'0')");
        c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[单位],[使用数量],[顺序]) VALUES(N'K-ZP',N'ZPM1',N'纸箱',N'个',2,1)");
        c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[单位],[使用数量],[顺序]) VALUES(N'K-ZP',N'ZPM2',N'胶袋',N'克',0.5,2)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE d FROM [装配加工采购单明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'ZP测试客户'");
        c.Execute("DELETE d FROM [装配加工采购单生产明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'ZP测试客户'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [客户名称]=N'ZP测试客户'");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'K-ZP'");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'K-ZP'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'ZPM1',N'ZPM2',N'ZPM3')");
    }

    // 模拟前端: 按当前 BOM 展开辅料行,生成保存载荷
    private static AssemblyPurchaseOrderSaveDto MakeDtoFromBom(SqlConnection c, decimal 加工数量 = 100)
    {
        var bom = c.Query<(string? 物料编号, string? 物料名称, string? 单位, decimal? 使用数量)>(
            "SELECT [物料编号],[物料名称],[单位],[使用数量] FROM [款号物料明细表] WHERE [款号]=N'K-ZP' ORDER BY [顺序]").AsList();
        return new AssemblyPurchaseOrderSaveDto
        {
            供应商编号 = "G01",
            供应商名称 = "ZP测试加工厂",
            客户编号 = "C01",
            客户名称 = "ZP测试客户",
            收货仓库 = "半成品仓",
            单价 = 1.5m,
            生产明细 =
            {
                new() { 接单日期 = "2026-07-28", 生产单号 = "ZP-MO", 款号 = "K-ZP", 产品名称 = "装配采购单测试款", 加工数量 = 加工数量, 单价 = 1.5m }
            },
            物料明细 = bom.Select(b => new AssemblyPurchaseOrderSaveLineDto
            {
                生产单号 = "ZP-MO",
                款号 = "K-ZP",
                物料编号 = b.物料编号,
                物料名称 = b.物料名称,
                单位 = b.单位,
                用量 = b.使用数量,
                需求数量 = 加工数量 * (b.使用数量 ?? 0m),
            }).ToList(),
        };
    }

    [SkippableFact]
    public async Task Create_then_Get_reads_snapshot_lines()
    {
        using var c = fx.Open(); SeedBom(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");
            Assert.StartsWith("ZP", 单号);

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(100m, d!.生产明细[0].加工数量);
            Assert.Equal(150m, d.生产明细[0].金额);
            Assert.Equal(2, d.辅料表.Count);
            Assert.Equal("ZPM1", d.辅料表[0].辅料编号);
            Assert.Equal(2m, d.辅料表[0].单个产品需求量);
            Assert.Equal(200m, d.辅料表[0].需求数个);
            Assert.Equal("ZPM2", d.辅料表[1].辅料编号);
            Assert.Equal(50m, d.辅料表[1].需求数克);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Bom_change_after_save_does_not_affect_saved_order()
    {
        using var c = fx.Open(); SeedBom(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");

            // 修改半成品BOM: 改用量 + 删一行 + 加一行
            c.Execute("UPDATE [款号物料明细表] SET [使用数量]=9 WHERE [款号]=N'K-ZP' AND [物料编号]=N'ZPM1'");
            c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'K-ZP' AND [物料编号]=N'ZPM2'");
            c.Execute("INSERT INTO [款号物料明细表]([款号],[物料编号],[物料名称],[单位],[使用数量],[顺序]) VALUES(N'K-ZP',N'ZPM3',N'新料',N'个',1,3)");

            // 已保存的单仍读快照
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(2, d!.辅料表.Count);
            Assert.Equal("ZPM1", d.辅料表[0].辅料编号);
            Assert.Equal(2m, d.辅料表[0].单个产品需求量);
            Assert.Equal(200m, d.辅料表[0].需求数个);
            Assert.Equal("ZPM2", d.辅料表[1].辅料编号);

            // 之后新开的单按新 BOM 生效
            var 单号2 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");
            var d2 = await Svc().GetAsync(单号2);
            Assert.NotNull(d2);
            Assert.Equal(2, d2!.辅料表.Count);
            Assert.Equal(900m, d2.辅料表[0].需求数个);
            Assert.Equal("ZPM3", d2.辅料表[1].辅料编号);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Update_only_when_unapproved()
    {
        using var c = fx.Open(); SeedBom(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");

            var dto = MakeDtoFromBom(c, 加工数量: 60);
            Assert.True(await Svc().UpdateAsync(单号, dto, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal(60m, d!.生产明细[0].加工数量);
            Assert.Equal(120m, d.辅料表[0].需求数个);

            Assert.True(await engine.ApproveAsync("装配加工采购单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().UpdateAsync(单号, dto, "tester"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_then_Unapprove_flips_审核()
    {
        using var c = fx.Open(); SeedBom(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");
            Assert.True(await engine.ApproveAsync("装配加工采购单", 单号, "tester"));
            Assert.False(await engine.ApproveAsync("装配加工采购单", 单号, "tester"));

            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [装配加工采购单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);

            Assert.True(await engine.UnapproveAsync("装配加工采购单", 单号, "tester"));
            d = await Svc().GetAsync(单号);
            Assert.Equal("0", d!.单头!.审核);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Get_returns_supervisor_manager_audit_fields()
    {
        using var c = fx.Open(); SeedBom(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");
            var chain = new PurchaseApprovalChainService(Factory());

            // 主管审核后:详情必须带回 主管审核/主管审核人(前端据此切「经理审核」按钮),经理字段仍空
            await chain.SupervisorApproveAsync("装配加工采购单", 单号, "admin");
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.主管审核);
            Assert.Equal("admin", d.单头.主管审核人);
            Assert.Null(d.单头.经理审核);

            // 经理审核后:经理字段同样带回
            await chain.ManagerApproveAsync("装配加工采购单", 单号, "admin");
            d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.经理审核);
            Assert.Equal("admin", d.单头.经理审核人);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_unapproved_ok_approved_throws()
    {
        using var c = fx.Open(); SeedBom(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDtoFromBom(c), "tester");
            Assert.True(await engine.ApproveAsync("装配加工采购单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));

            Assert.True(await engine.UnapproveAsync("装配加工采购单", 单号, "tester"));
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Null(await Svc().GetAsync(单号));
        }
        finally { Clean(c); }
    }
}
