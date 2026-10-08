using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 采购订单三级流转:开单 → 主管审核 → 经理审核 → 审核(下发,posting 审核='1')。
// 覆盖 塑胶采购订单 与 来料仓采购订单;共享服务 PurchaseApprovalChainService(白名单表,admin 代办放行,不限部门)。
// 对齐 PlasticIssueApprovalChainDbTests 的写法;controller 的 approve 门 = IsManagerApprovedAsync,这里直接验证门与服务链。
[Collection("db")]
public class PurchaseApprovalChainDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PurchaseApprovalChainService Chain() => new(Factory());

    private static string New单号() => $"CHAIN{Guid.NewGuid():N}"[..20];

    private static void SeedDoc(SqlConnection c, string table, string 单号)
        => c.Execute($"INSERT INTO [{table}]([单号],[日期],[操作员]) VALUES(@单号,GETDATE(),'tester')", new { 单号 });

    private static void Clean(SqlConnection c, string table, string 单号)
        => c.Execute($"DELETE FROM [{table}] WHERE [单号]=@单号", new { 单号 });

    [SkippableTheory]
    [InlineData("塑胶采购订单")]
    [InlineData("采购订单")]
    public async Task 三级流转_主管经理审完才能审核下发(string table)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var 单号 = New单号();
        SeedDoc(c, table, 单号);
        try
        {
            var chain = Chain();
            // 下发门:未经主管/经理审核 → false(controller 据此 409 拒绝 approve)
            Assert.False(await chain.IsManagerApprovedAsync(table, 单号));

            // 顺序颠倒:未主管先经理 → 拒绝
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.ManagerApproveAsync(table, 单号, "admin"));

            // 主管审核(admin 代办) → 置位 + 记录审核人;门仍关
            await chain.SupervisorApproveAsync(table, 单号, "admin");
            Assert.Equal("admin", c.ExecuteScalar<string>($"SELECT [主管审核人] FROM [{table}] WHERE [单号]=@单号", new { 单号 }));
            Assert.False(await chain.IsManagerApprovedAsync(table, 单号));

            // 经理审核(admin 代办) → 门打开
            await chain.ManagerApproveAsync(table, 单号, "admin");
            Assert.Equal("admin", c.ExecuteScalar<string>($"SELECT [经理审核人] FROM [{table}] WHERE [单号]=@单号", new { 单号 }));
            Assert.True(await chain.IsManagerApprovedAsync(table, 单号));

            // posting 审核(=下发)成功
            var posting = new PostingEngine(Factory(), new AuditLogger());
            Assert.True(await posting.ApproveAsync(table, 单号, "wh"));
            Assert.Equal("1", c.ExecuteScalar<string>($"SELECT ISNULL([审核],'0') FROM [{table}] WHERE [单号]=@单号", new { 单号 }));

            // 反审核不清主管/经理标记(与领料单一致)
            Assert.True(await posting.UnapproveAsync(table, 单号, "wh"));
            Assert.Equal("1", c.ExecuteScalar<string>($"SELECT ISNULL([主管审核],'0') FROM [{table}] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal("1", c.ExecuteScalar<string>($"SELECT ISNULL([经理审核],'0') FROM [{table}] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c, table, 单号); }
    }

    [SkippableTheory]
    [InlineData("塑胶采购订单")]
    [InlineData("采购订单")]
    public async Task 无职称用户不能主管经理审核(string table)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var 单号 = New单号();
        SeedDoc(c, table, 单号);
        try
        {
            var chain = Chain();
            var 无名氏 = $"不存在的人{Guid.NewGuid():N}"[..20];
            // 人事档案 无此姓名/职称 → 两级都拒
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync(table, 单号, 无名氏));
            await chain.SupervisorApproveAsync(table, 单号, "admin");
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.ManagerApproveAsync(table, 单号, 无名氏));
            // 重复主管审核 → 拒
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync(table, 单号, "admin"));
        }
        finally { Clean(c, table, 单号); }
    }

    [SkippableFact]
    public async Task 白名单外表被拒()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var chain = Chain();
        await Assert.ThrowsAsync<InvalidOperationException>(() => chain.IsManagerApprovedAsync("部门信息", "X"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("人事档案", "X", "admin"));
    }

    // ---- 部门限定(10 表白名单:主管=责任部门主管,经理不限部门) ----

    private const string 装配主管 = "链测装配主管";   // 02 装配部
    private const string 仓务主管 = "链测仓务主管";   // 05 仓务部
    private const string 啤机主管 = "链测啤机主管";   // 06 啤机部
    private const string 喷油主管 = "链测喷油主管";   // 20 喷油部
    private const string 测试经理 = "链测经理";       // 经理(任意部门,这里放 05)

    // 种子:责任部门 02/05/06/20 + 人事档案 主管/经理;返回本次新插入的部门编号(自清用)
    private static List<string> SeedOrg(SqlConnection c)
    {
        var inserted = new List<string>();
        foreach (var (code, name) in new[] { ("02", "装配部"), ("05", "仓务部"), ("06", "啤机部"), ("20", "喷油部") })
        {
            if (c.ExecuteScalar<int>("SELECT COUNT(*) FROM [部门信息] WHERE [编号]=@code", new { code }) == 0)
            {
                c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(@code,@name)", new { code, name });
                inserted.Add(code);
            }
        }
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=@n) INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('CT01',@n,N'主管',N'02')", new { n = 装配主管 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=@n) INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('CT02',@n,N'主管',N'05')", new { n = 仓务主管 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=@n) INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('CT03',@n,N'主管',N'06')", new { n = 啤机主管 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=@n) INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('CT04',@n,N'主管',N'20')", new { n = 喷油主管 });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=@n) INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('CT05',@n,N'经理',N'05')", new { n = 测试经理 });
        return inserted;
    }

    private static void CleanOrg(SqlConnection c, List<string> insertedDepts)
    {
        c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (@a,@b,@d,@e,@f)",
            new { a = 装配主管, b = 仓务主管, d = 啤机主管, e = 喷油主管, f = 测试经理 });
        foreach (var code in insertedDepts)
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=@code", new { code });
    }

    private static void Seed领料单(SqlConnection c, string 单号, string? 领料部门)
        => c.Execute("INSERT INTO [领料单]([单号],[日期],[领料部门],[操作员]) VALUES(@单号,GETDATE(),@领料部门,'tester')", new { 单号, 领料部门 });

    [SkippableFact]
    public async Task 领料单_责任部门主管审_经理不限部门_门放行()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var depts = SeedOrg(c);
        var 单号 = New单号();
        Seed领料单(c, 单号, "装配部");
        try
        {
            var chain = Chain();
            var 无名氏 = $"不存在的人{Guid.NewGuid():N}"[..20];
            // 非主管不能主管审核
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("领料单", 单号, 无名氏));
            // 跨部门拒绝:仓务部主管不能审 领料部门=装配部 的单;错误消息带部门名
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("领料单", 单号, 仓务主管));
            Assert.Contains("装配部", ex.Message);
            // 装配部主管能审
            await chain.SupervisorApproveAsync("领料单", 单号, 装配主管);
            Assert.Equal(装配主管, c.ExecuteScalar<string>("SELECT [主管审核人] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            // 非经理不能经理审核
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.ManagerApproveAsync("领料单", 单号, 装配主管));
            // 经理不限部门(种子在 05 仓务部)能审 → 门放行
            await chain.ManagerApproveAsync("领料单", 单号, 测试经理);
            Assert.True(await chain.IsManagerApprovedAsync("领料单", 单号));
        }
        finally { Clean(c, "领料单", 单号); CleanOrg(c, depts); }
    }

    [SkippableFact]
    public async Task 领料单_领料部门查不到时退回装配部()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var depts = SeedOrg(c);
        var 单号 = New单号();
        Seed领料单(c, 单号, "不存在的部门XYZ");
        try
        {
            var chain = Chain();
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("领料单", 单号, 仓务主管));
            await chain.SupervisorApproveAsync("领料单", 单号, 装配主管);   // 退回 02 装配部
            Assert.Equal("1", c.ExecuteScalar<string>("SELECT ISNULL([主管审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c, "领料单", 单号); CleanOrg(c, depts); }
    }

    [SkippableFact]
    public async Task 塑胶采购订单_固定仓务部_装配部主管不能审()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var depts = SeedOrg(c);
        var 单号 = New单号();
        SeedDoc(c, "塑胶采购订单", 单号);
        try
        {
            var chain = Chain();
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("塑胶采购订单", 单号, 装配主管));
            Assert.Contains("仓务部", ex.Message);
            await chain.SupervisorApproveAsync("塑胶采购订单", 单号, 仓务主管);
            Assert.Equal("1", c.ExecuteScalar<string>("SELECT ISNULL([主管审核],'0') FROM [塑胶采购订单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c, "塑胶采购订单", 单号); CleanOrg(c, depts); }
    }

    [SkippableFact]
    public async Task 白件领料单_固定喷油部主管能审()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var depts = SeedOrg(c);
        var 单号 = New单号();
        SeedDoc(c, "白件领料单", 单号);
        try
        {
            var chain = Chain();
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("白件领料单", 单号, 仓务主管));
            await chain.SupervisorApproveAsync("白件领料单", 单号, 喷油主管);   // 固定 20 喷油部
            await chain.ManagerApproveAsync("白件领料单", 单号, 测试经理);
            Assert.True(await chain.IsManagerApprovedAsync("白件领料单", 单号));
        }
        finally { Clean(c, "白件领料单", 单号); CleanOrg(c, depts); }
    }

    [SkippableFact]
    public async Task 原料出库单_固定啤机部主管能审()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var depts = SeedOrg(c);
        var 单号 = New单号();
        SeedDoc(c, "原料出库单", 单号);
        try
        {
            var chain = Chain();
            await Assert.ThrowsAsync<InvalidOperationException>(() => chain.SupervisorApproveAsync("原料出库单", 单号, 喷油主管));
            await chain.SupervisorApproveAsync("原料出库单", 单号, 啤机主管);   // 固定 06 啤机部
            await chain.ManagerApproveAsync("原料出库单", 单号, 测试经理);
            Assert.True(await chain.IsManagerApprovedAsync("原料出库单", 单号));
        }
        finally { Clean(c, "原料出库单", 单号); CleanOrg(c, depts); }
    }
}
