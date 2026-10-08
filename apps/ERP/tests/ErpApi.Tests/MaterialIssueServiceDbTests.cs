using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.MaterialIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static MaterialIssueCreateDto Dto() => new()
    {
        领料部门 = "车间一", 领料人 = "张三", 仓库 = P3TestData.仓库, 接受人 = "测试仓管",
        明细 = [ new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 30, 单价 = 10 } ]
    };

    // 接受人必须是 职称=仓管/PMC 的人事档案人员：测试前种一个，结束清掉
    private static void SeedRecipient(Microsoft.Data.SqlClient.SqlConnection c) =>
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=N'测试仓管') INSERT INTO [人事档案]([姓名],[职称]) VALUES(N'测试仓管',N'仓管')");
    private static void CleanRecipient(Microsoft.Data.SqlClient.SqlConnection c) =>
        c.Execute("DELETE FROM [人事档案] WHERE [姓名]=N'测试仓管'");

    [SkippableFact]
    public async Task Create_then_Get_then_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedRecipient(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("LL", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            var detail = await Svc().GetAsync(单号);
            Assert.Single(detail!.明细);
            Assert.Equal("车间一", detail.单头!.领料部门);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [领料明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c); CleanRecipient(c);
            c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (N'测试主管',N'测试经理'); DELETE FROM [部门信息] WHERE [编号]='T9'");
        }
    }

    [SkippableFact]
    public async Task Create_persists_生产单号_款号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedRecipient(c);
        var dto = Dto();
        dto.明细[0].生产单号 = "MO-2026-001";
        dto.明细[0].款号 = "K123";
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var detail = await Svc().GetAsync(单号);
            var line = Assert.Single(detail!.明细);
            Assert.Equal("MO-2026-001", line.生产单号);
            Assert.Equal("K123", line.款号);
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c); CleanRecipient(c);
            c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (N'测试主管',N'测试经理'); DELETE FROM [部门信息] WHERE [编号]='T9'");
        }
    }

    [SkippableFact]
    public async Task Create_uses_requested_date_for_header_and_detail()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedRecipient(c);
        var dto = Dto();
        dto.日期 = new DateTime(2026, 7, 9);
        var 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            Assert.StartsWith("LL20260709", 单号);
            Assert.Equal(dto.日期.Value.Date, c.ExecuteScalar<DateTime>(
                "SELECT CAST([日期] AS date) FROM [领料单] WHERE [单号]=@单号", new { 单号 }).Date);
            Assert.Equal(dto.日期.Value.Date, c.ExecuteScalar<DateTime>(
                "SELECT CAST([日期] AS date) FROM [领料明细单] WHERE [单号]=@单号", new { 单号 }).Date);
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c); CleanRecipient(c);
            c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (N'测试主管',N'测试经理'); DELETE FROM [部门信息] WHERE [编号]='T9'");
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task Create_rejects_blank_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.仓库 = null;
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task Outbound_partial_twice_then_completes_and_blocks_over_issue()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedRecipient(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester"); // 申请数量=30
        try
        {
            // 三级流转：主管/经理必须是 该部门对应职称的人(种 车间一 的测试主管/测试经理)
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [部门信息] WHERE [编号]='T9') INSERT INTO [部门信息]([编号],[部门]) VALUES('T9',N'车间一')");
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('T901',N'测试主管',N'主管',N'T9'),('T902',N'测试经理',N'经理',N'T9')");
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().ManagerApproveAsync(单号, "测试经理"));   // 未主管审核直接经理审核 → 拒绝
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().SupervisorApproveAsync(单号, "tester"));  // 非主管职称 → 拒绝
            await Svc().SupervisorApproveAsync(单号, "测试主管");
            await Svc().ManagerApproveAsync(单号, "测试经理");
            Assert.Equal("测试主管", c.ExecuteScalar<string>("SELECT [主管审核人] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal("测试经理", c.ExecuteScalar<string>("SELECT [经理审核人] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));

            var detail = await Svc().GetAsync(单号);
            var 行ID = Assert.Single(detail!.明细).ID;

            // 第一次部分出库 10：未完成,单据仍 未审核
            var r1 = await Svc().OutboundAsync(单号, [new MaterialIssueOutboundLineDto { 行ID = 行ID, 数量 = 10 }], "wh");
            Assert.False(r1.完成);
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT ISNULL([审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(10m, c.ExecuteScalar<decimal>("SELECT [已出数量] FROM [领料明细单] WHERE [ID]=@行ID", new { 行ID }));

            // 超领拦截：未领 20,出 21 → InvalidOperationException
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().OutboundAsync(单号, [new MaterialIssueOutboundLineDto { 行ID = 行ID, 数量 = 21 }], "wh"));

            // 第二次出库 20：全部出完,自动置 审核='1'
            var r2 = await Svc().OutboundAsync(单号, [new MaterialIssueOutboundLineDto { 行ID = 行ID, 数量 = 20 }], "wh");
            Assert.True(r2.完成);
            Assert.Equal("1", c.ExecuteScalar<string>("SELECT ISNULL([审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 }));

            // 完成后拒绝再次出库
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().OutboundAsync(单号, [new MaterialIssueOutboundLineDto { 行ID = 行ID, 数量 = 1 }], "wh"));
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c); CleanRecipient(c);
            c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (N'测试主管',N'测试经理'); DELETE FROM [部门信息] WHERE [编号]='T9'");
        }
    }
}
