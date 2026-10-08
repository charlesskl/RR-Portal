using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ShiftServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Save_Get_ReSave_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var svc = new ShiftService(Factory());
        using var c = fx.Open();
        try
        {
            await svc.SaveAsync(new ShiftDto
            {
                识别 = "S1", 名称 = "常日班",
                上午上班 = "08:00", 上午下班 = "12:00", 下午上班 = "13:00", 下午下班 = "17:00",
                总小时 = 8, 迟到分钟 = 5, 早退分钟 = 5
            }, "tester");

            var d = await svc.GetAsync("S1");
            Assert.NotNull(d);
            Assert.Equal("08:00", d!.上午上班);
            Assert.Equal("17:00", d.下午下班);
            Assert.Equal(5m, d.迟到分钟);

            // 同识别再保存改名称 → 更新非重复
            await svc.SaveAsync(new ShiftDto
            {
                识别 = "S1", 名称 = "常日班V2",
                上午上班 = "08:00", 上午下班 = "12:00", 下午上班 = "13:00", 下午下班 = "17:00",
                总小时 = 8, 迟到分钟 = 5, 早退分钟 = 5
            }, "tester");
            var rows = await svc.ListAsync(null);
            var s1 = rows.Where(x => x.识别 == "S1").ToList();
            Assert.Single(s1);
            Assert.Equal("常日班V2", s1[0].名称);

            Assert.True(await svc.DeleteAsync("S1"));
            var after = await svc.ListAsync(null);
            Assert.DoesNotContain(after, x => x.识别 == "S1");
        }
        finally { c.Execute("DELETE FROM [考勤_排班表] WHERE [识别]='S1'"); }
    }
}
