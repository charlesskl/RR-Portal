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
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var employee = "W" + suffix;
        var department = "D" + suffix;
        void Clean()
        {
            c.Execute("DELETE FROM [计件表] WHERE [员工号]=@employee", new { employee });
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=@employee", new { employee });
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=@department", new { department });
        }
        try
        {
            c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(@department,N'裁床部')", new { department });
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号]) VALUES(@employee,N'张三',@department)", new { employee, department });
            // 当月审核有效两条（金额=数量×单价 直接给）
            c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@employee,N'01',10,2,20,'2026-05-10','1','1')", new { employee });
            c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@employee,N'02',5,2,10,'2026-05-20','1','1')", new { employee });
            // 他月（不计）
            c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@employee,N'01',99,2,198,'2026-04-30','1','1')", new { employee });
            // 未审核（不计）
            c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@employee,N'01',99,2,198,'2026-05-15','0','1')", new { employee });
            // 无效（不计）
            c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(@employee,N'01',99,2,198,'2026-05-16','1','0')", new { employee });
            var rows = await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", null);
            var r = Assert.Single(rows.Where(row => row.编号 == employee));
            Assert.Equal(employee, r.编号);
            Assert.Equal("张三", r.姓名);
            Assert.Equal("裁床部", r.部门);
            Assert.Equal(15m, r.数量);       // 10+5
            Assert.Equal(30m, r.计件工资);    // 20+10

            Assert.Single(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", department));
            Assert.Empty(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", "别的部门"));
        }
        finally { Clean(); }
    }
}
