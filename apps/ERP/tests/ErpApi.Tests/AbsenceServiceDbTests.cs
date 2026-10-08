using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AbsenceServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 缺勤登记_CRUD_按月筛选()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [b缺勤登记明细] WHERE [工号]=N'P7BE1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P7BE1'");
        }
        Clean();
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[在职]) VALUES(N'P7BE1',N'测试员',N'P7BD1','1')");
        try
        {
            var svc = new AbsenceService(Factory());
            var id = await svc.CreateAsync(new AbsenceCreateDto
            {
                工号 = "P7BE1",
                姓名 = "测试员",
                部门 = "P7BD1",
                登记类型 = "事假",
                计算出勤 = 1m,
                日期 = new DateTime(2026, 5, 10),
            }, "admin");
            Assert.True(id > 0);

            // 他月一条（按月筛选不应命中）
            await svc.CreateAsync(new AbsenceCreateDto
            {
                工号 = "P7BE1",
                登记类型 = "病假",
                计算出勤 = 1m,
                日期 = new DateTime(2026, 4, 30),
            }, "admin");

            var page = await svc.ListAsync("202605", null, null, 1, 20);
            Assert.True(page.Total >= 1);
            var row = Assert.Single(page.Items, r => r.ID == id);
            Assert.Equal("P7BE1", row.工号);
            Assert.Equal("事假", row.登记类型);
            Assert.Equal(1m, row.计算出勤);
            // 他月那条不在 202605 结果里
            Assert.DoesNotContain(page.Items, r => r.日期 == new DateTime(2026, 4, 30));

            Assert.True(await svc.DeleteAsync(id));
        }
        finally { Clean(); }
    }
}
