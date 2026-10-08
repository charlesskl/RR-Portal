using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AttendanceServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Monthly_实出勤等于应出勤减缺勤_仅在职员工()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [b缺勤登记明细] WHERE [工号] IN (N'P7BE1',N'P7BE2',N'P7BE0')");
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN (N'P7BE1',N'P7BE2',N'P7BE0')");
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=N'P7BD1'");
        }
        Clean();
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(N'P7BD1',N'裁床部')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'P7BE1',N'张三',N'P7BD1','1')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'P7BE2',N'李四',N'P7BD1','1')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'P7BE0',N'离职',N'P7BD1','0')");
        // P7BE1 当月两条缺勤，计算出勤为字符串 '1'+'1'=2（列为 nvarchar(6)）
        c.Execute("INSERT INTO [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(N'P7BE1',N'1','2026-05-10')");
        c.Execute("INSERT INTO [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(N'P7BE1',N'1','2026-05-20')");
        // 他月一条（不计当月）
        c.Execute("INSERT INTO [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(N'P7BE1',N'5','2026-04-30')");
        try
        {
            var rows = await new AttendanceService(Factory()).MonthlyAsync("202605", 26m, null);

            var e1 = rows.First(r => r.工号 == "P7BE1");
            Assert.Equal("张三", e1.姓名);
            Assert.Equal("裁床部", e1.部门);
            Assert.Equal(26m, e1.应出勤天数);
            Assert.Equal(2m, e1.缺勤天数);
            Assert.Equal(24m, e1.实出勤天数);

            var e2 = rows.First(r => r.工号 == "P7BE2");
            Assert.Equal(0m, e2.缺勤天数);
            Assert.Equal(26m, e2.实出勤天数);

            // 离职员工不出现
            Assert.DoesNotContain(rows, r => r.工号 == "P7BE0");

            // 部门筛选 P7BD1 命中 P7BE1
            var dept = await new AttendanceService(Factory()).MonthlyAsync("202605", 26m, "P7BD1");
            Assert.Contains(dept, r => r.工号 == "P7BE1");
            Assert.DoesNotContain(dept, r => r.工号 == "P7BE0");
        }
        finally { Clean(); }
    }
}
