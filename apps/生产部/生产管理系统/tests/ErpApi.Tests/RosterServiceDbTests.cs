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
        void Clean()
        {
            c.Execute("DELETE FROM [排班表] WHERE [工号]=N'R_E1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'R_E1'");
            c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]=N'R_S1'");
        }
        Clean();
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'R_E1',N'排班测试员',N'R_D1','1')");
        var sid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
        c.Execute("INSERT INTO [考勤_排班表]([排班ID],[识别],[名称]) VALUES(@sid,N'R_S1',N'常日班')", new { sid });
        try
        {
            var svc = new RosterService(Factory());
            var d0 = new DateTime(2026, 3, 2);

            await svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = ["R_E1"],
                开始日期 = d0,
                结束日期 = d0.AddDays(1),
                班次 = "R_S1",
            }, "admin");

            var rows = await svc.ListAsync(d0, d0.AddDays(1), null);
            Assert.Equal(2, rows.Count);
            Assert.All(rows, r => Assert.Equal("R_S1", r.班次));
            Assert.All(rows, r => Assert.Equal("排班测试员", r.姓名));

            // 同工号同首日 再派 班次仍 R_S1 → 首日更新非新增
            await svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = ["R_E1"],
                开始日期 = d0,
                结束日期 = d0,
                班次 = "R_S1",
            }, "admin");
            var rows2 = await svc.ListAsync(d0, d0.AddDays(1), null);
            Assert.Equal(2, rows2.Count);

            // 删除首日 → 剩 1 条
            Assert.True(await svc.RemoveAsync("R_E1", d0));
            var rows3 = await svc.ListAsync(d0, d0.AddDays(1), null);
            Assert.Single(rows3);

            // 班次不存在 → 抛 ArgumentException
            await Assert.ThrowsAsync<ArgumentException>(() => svc.AssignAsync(new RosterAssignDto
            {
                工号集合 = ["R_E1"],
                开始日期 = d0,
                结束日期 = d0,
                班次 = "NOEXIST",
            }, "admin"));
        }
        finally { Clean(); }
    }
}
