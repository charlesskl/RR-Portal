using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 塑胶领料单三级流转:开单 → 主管审核 → 经理审核 → 塑胶仓出库(posting 审核)。
// 对齐 MaterialIssueServiceDbTests 的种子写法(部门信息 T8 + 人事档案 主管/经理)。
[Collection("db")]
public class PlasticIssueApprovalChainDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    // 测试不传 MessageService(可空参数),不发消息
    private PlasticIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static PlasticIssueCreateDto Dto() => new()
    {
        领料部门 = "塑胶测试部", 领料人 = "张三", 仓库 = "塑胶仓", 收件人 = "测试仓管",
        明细 = [ new PlasticIssueCreateLineDto { 物料编号 = "SLLM01", 物料名称 = "SLL测试料", 单位 = "PCS", 数量 = 10 } ],
    };

    private static void SeedRoles(SqlConnection c)
    {
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [部门信息] WHERE [编号]='T8') INSERT INTO [部门信息]([编号],[部门]) VALUES('T8',N'塑胶测试部')");
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=N'SLL测试主管') INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('T801',N'SLL测试主管',N'主管',N'T8')");
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [人事档案] WHERE [姓名]=N'SLL测试经理') INSERT INTO [人事档案]([编号],[姓名],[职称],[部门编号]) VALUES('T802',N'SLL测试经理',N'经理',N'T8')");
    }

    private static void Clean(SqlConnection c, string 单号)
    {
        c.Execute("DELETE FROM [塑胶领料明细单] WHERE [单号]=@单号", new { 单号 });
        c.Execute("DELETE FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 });
        c.Execute("DELETE FROM [人事档案] WHERE [姓名] IN (N'SLL测试主管',N'SLL测试经理'); DELETE FROM [部门信息] WHERE [编号]='T8'");
    }

    [SkippableFact]
    public async Task 三级流转_主管经理审完才能出库审核()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedRoles(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("SLL", 单号);
            // 出库门:未经理审核 → 不能出库审核
            Assert.False(await Svc().IsManagerApprovedAsync(单号));

            // 未主管审核直接经理审核 → 拒绝
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().ManagerApproveAsync(单号, "SLL测试经理"));
            // 非主管职称 → 拒绝
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().SupervisorApproveAsync(单号, "tester"));

            // 主管审核 → 置位 + 记录审核人
            await Svc().SupervisorApproveAsync(单号, "SLL测试主管");
            Assert.Equal("SLL测试主管", c.ExecuteScalar<string>("SELECT [主管审核人] FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.False(await Svc().IsManagerApprovedAsync(单号));   // 经理未审仍不能出库

            // 经理审核 → 门打开
            await Svc().ManagerApproveAsync(单号, "SLL测试经理");
            Assert.Equal("SLL测试经理", c.ExecuteScalar<string>("SELECT [经理审核人] FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.True(await Svc().IsManagerApprovedAsync(单号));

            // posting 审核(=塑胶仓出库)成功
            var posting = new PostingEngine(Factory(), new AuditLogger());
            Assert.True(await posting.ApproveAsync("塑胶领料单", 单号, "wh"));
            Assert.Equal("1", c.ExecuteScalar<string>("SELECT ISNULL([审核],'0') FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c, 单号); }
    }

    [SkippableFact]
    public async Task 重复主管审核被拒()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedRoles(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            await Svc().SupervisorApproveAsync(单号, "SLL测试主管");
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().SupervisorApproveAsync(单号, "SLL测试主管"));
        }
        finally { Clean(c, 单号); }
    }
}
