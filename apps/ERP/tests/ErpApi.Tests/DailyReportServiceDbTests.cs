using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class DailyReportServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 日报_取排班算引擎_整条替换_未排班抛()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        var d0 = new DateTime(2026, 3, 2);
        void Clean()
        {
            c.Execute("DELETE FROM [日报表] WHERE [工号]=N'D_E1'");
            c.Execute("DELETE FROM [排班表] WHERE [工号]=N'D_E1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'D_E1'");
            c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]=N'D_S1'");
        }
        Clean();
        // 人事档案 D_E1 / 部门 D_D1
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'D_E1',N'日报测试员',N'D_D1','1')");
        // 班次模板 D_S1: 上午 08:00-12:00 下午 13:00-17:00 迟到/早退宽限 5 分
        var sid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
        c.Execute(@"INSERT INTO [考勤_排班表]([排班ID],[识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[迟到分钟],[早退分钟])
VALUES(@sid,N'D_S1',N'常日班',
  CAST('1900-01-01 08:00' AS datetime),CAST('1900-01-01 12:00' AS datetime),
  CAST('1900-01-01 13:00' AS datetime),CAST('1900-01-01 17:00' AS datetime),5,5)", new { sid });
        // 排班 D_E1 当日 D_S1
        var rid = c.ExecuteScalar<long>("SELECT ISNULL(MAX([ID]),0)+1 FROM [排班表]");
        c.Execute("INSERT INTO [排班表]([ID],[工号],[姓名],[日期],[班次]) VALUES(@rid,N'D_E1',N'日报测试员',@d0,N'D_S1')",
            new { rid, d0 });
        try
        {
            var svc = new DailyReportService(Factory());

            // 迟到5分(扣宽限5→0)、下午加班30分(0.5h)
            await svc.SaveAsync(new DailySaveDto { 工号 = "D_E1", 日期 = d0, 刷卡 = ["08:05", "12:00", "13:00", "17:30"] }, "admin");
            var rows = await svc.ListAsync("D_E1", d0, d0, null);
            Assert.Single(rows);
            var row = rows[0];
            Assert.Equal(0, row.迟到分);
            Assert.Equal("D_D1", row.部门);
            Assert.Equal(0.5m, row.加班!.Value, 2);
            // 08:05 到岗 → 上午实做 3.92h(从打卡时刻起算),下午 4h → 合计 7.92
            Assert.Equal(7.92m, row.合计时间!.Value, 2);

            // 重算同工号同日(整条替换):全勤无迟到无加班
            await svc.SaveAsync(new DailySaveDto { 工号 = "D_E1", 日期 = d0, 刷卡 = ["08:00", "12:00", "13:00", "17:00"] }, "admin");
            var rows2 = await svc.ListAsync("D_E1", d0, d0, null);
            Assert.Single(rows2);
            Assert.Equal(0, rows2[0].迟到分);
            Assert.Equal(0m, rows2[0].加班!.Value, 2);
            Assert.Equal(8m, rows2[0].合计时间!.Value, 2);

            // 未排班工号 → 抛 ArgumentException
            await Assert.ThrowsAsync<ArgumentException>(() =>
                svc.SaveAsync(new DailySaveDto { 工号 = "D_NOPE", 日期 = d0, 刷卡 = ["08:00"] }, "admin"));
        }
        finally { Clean(); }
    }
}
