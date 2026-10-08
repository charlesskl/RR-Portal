using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PieceworkPayrollServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Monthly_仅计当月审核有效()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [计件表] WHERE [员工号]=N'P7AE1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P7AE1'");
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=N'P7AD1'");
        }
        Clean();
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(N'P7AD1',N'裁床部')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号]) VALUES(N'P7AE1',N'张三',N'P7AD1')");
        // 当月审核有效两条（金额=数量×单价 直接给）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',10,2,20,'2026-05-10','1','1')");
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'02',5,2,10,'2026-05-20','1','1')");
        // 他月（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-04-30','1','1')");
        // 未审核（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-05-15','0','1')");
        // 无效（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-05-16','1','0')");
        try
        {
            var rows = await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", null);
            var r = Assert.Single(rows);
            Assert.Equal("P7AE1", r.编号);
            Assert.Equal("张三", r.姓名);
            Assert.Equal("裁床部", r.部门);
            Assert.Equal(15m, r.数量);       // 10+5
            Assert.Equal(30m, r.计件工资);    // 20+10

            Assert.Single(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", "P7AD1"));
            Assert.Empty(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", "别的部门"));
        }
        finally { Clean(); }
    }
}
