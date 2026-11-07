using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class RosterServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 排班_批量派班_去重更新_删除_校验班次()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var employee = "R" + suffix;
        var department = "D" + suffix;
        var shift = "S" + suffix;
        void Clean()
        {
            c.Execute("DELETE FROM [排班表] WHERE [工号]=@employee", new { employee });
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=@employee", new { employee });
            c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]=@shift", new { shift });
        }
        try
        {
            c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(@employee,N'排班测试员',@department,'1')", new { employee, department });
            var sid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
            c.Execute("INSERT INTO [考勤_排班表]([排班ID],[识别],[名称]) VALUES(@sid,@shift,N'常日班')", new { sid, shift });
            var svc = new RosterService(Factory());
            var d0 = new DateTime(2026, 3, 2);

            await svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = [employee],
                开始日期 = d0,
                结束日期 = d0.AddDays(1),
                班次 = shift,
            }, "admin");

            var rows = (await svc.ListAsync(d0, d0.AddDays(1), null)).Where(r => r.工号 == employee).ToList();
            Assert.Equal(2, rows.Count);
            Assert.All(rows, r => Assert.Equal(shift, r.班次));
            Assert.All(rows, r => Assert.Equal("排班测试员", r.姓名));

            // 同工号同首日再派同班次，首日更新而非新增。
            await svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = [employee],
                开始日期 = d0,
                结束日期 = d0,
                班次 = shift,
            }, "admin");
            var rows2 = (await svc.ListAsync(d0, d0.AddDays(1), null)).Where(r => r.工号 == employee).ToList();
            Assert.Equal(2, rows2.Count);

            // 删除首日 → 剩 1 条
            Assert.True(await svc.RemoveAsync(employee, d0));
            var rows3 = (await svc.ListAsync(d0, d0.AddDays(1), null)).Where(r => r.工号 == employee).ToList();
            Assert.Single(rows3);

            // 班次不存在 → 抛 ArgumentException
            await Assert.ThrowsAsync<ArgumentException>(() => svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = [employee],
                开始日期 = d0,
                结束日期 = d0,
                班次 = "NOEXIST",
            }, "admin"));
        }
        finally { Clean(); }
    }
}
