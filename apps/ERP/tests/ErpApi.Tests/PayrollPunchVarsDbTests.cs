using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PayrollPunchVarsDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private static PayrollService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Generate_刷卡变量_加班工时入公式()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var now = DateTime.Today;
        var 月份 = now.ToString("yyyyMM");
        var 日报日期 = new DateTime(now.Year, now.Month, 10);

        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [工资明细表] WHERE [月份]=@月份 AND [部门编号]=N'PV_D1'", new { 月份 });
            c.Execute("DELETE FROM [工资总表] WHERE [月份]=@月份 AND [部门编号]=N'PV_D1'", new { 月份 });
            c.Execute("DELETE FROM [工资表项目公式] WHERE [月份]=@月份 AND [部门编号]=N'PV_D1'", new { 月份 });
            c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号]=N'PV_T1'");
            c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号]=N'PV_T1'");
            c.Execute("DELETE FROM [日报表] WHERE [工号]=N'PV_E1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号] IN (N'PV_E1',N'PV_E2')");
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=N'PV_D1'");
        }
        Clean();

        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(N'PV_D1',N'车间')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[职称],[基本工资],[在职]) VALUES(N'PV_E1',N'张三',N'PV_D1',N'工人',1000,N'1')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[职称],[基本工资],[在职]) VALUES(N'PV_E2',N'李四',N'PV_D1',N'工人',1000,N'1')");
        // PV_E1 当月日报:合计时间8,加班2,迟到次数1,早退次数0;PV_E2 无日报
        c.Execute("INSERT INTO [日报表]([工号],[姓名],[部门],[日期],[合计时间],[加班],[迟到次数],[早退次数]) VALUES(N'PV_E1',N'张三',N'车间',@日报日期,8,2,1,0)",
            new { 日报日期 });

        // 工资模板 PV_T1:基本=基本工资、加班费=加班工时*10
        var 项 = new (int 序号, string 台头项目, string 类型, string 公式)[]
        {
            (1, "基本", "应发", "基本工资"),
            (2, "加班费", "应发", "加班工时*10"),
        };
        foreach (var (序号, 台头项目, 类型, 公式) in 项)
        {
            c.Execute("INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型]) VALUES(N'PV_T1',N'刷卡模板',@序号,@台头项目,@类型)",
                new { 序号, 台头项目, 类型 });
            c.Execute("INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式]) VALUES(N'PV_T1',N'刷卡模板',NULL,NULL,@序号,@台头项目,@公式)",
                new { 序号, 台头项目, 公式 });
        }

        try
        {
            var no = await Svc().GenerateAsync(
                new PayrollGenerateDto { 月份 = 月份, 部门编号 = "PV_D1", 模板编号 = "PV_T1", 应出勤天数 = 26 }, "tester");
            Assert.False(string.IsNullOrWhiteSpace(no));

            // 加班费 台头项目 → ZG 列名
            var 加班费列 = await c.ExecuteScalarAsync<string>(
                "SELECT [列名] FROM [工资表项目公式] WHERE [工资表编号]=@no AND [台头项目]=N'加班费'", new { no });
            Assert.False(string.IsNullOrWhiteSpace(加班费列));

            // PV_E1:加班工时2*10=20,应发合计=1000+20=1020
            var r1 = (IDictionary<string, object>)await c.QueryFirstAsync<dynamic>(
                "SELECT * FROM [工资明细表] WHERE [工资表编号]=@no AND [编号]=N'PV_E1'", new { no });
            Assert.Equal(20m, Convert.ToDecimal(r1[加班费列!]));
            Assert.Equal(1020m, Convert.ToDecimal(r1["应发合计"]));

            // PV_E2:无日报 → 加班工时缺省0,加班费=0,应发合计=1000
            var r2 = (IDictionary<string, object>)await c.QueryFirstAsync<dynamic>(
                "SELECT * FROM [工资明细表] WHERE [工资表编号]=@no AND [编号]=N'PV_E2'", new { no });
            Assert.Equal(0m, Convert.ToDecimal(r2[加班费列!]));
            Assert.Equal(1000m, Convert.ToDecimal(r2["应发合计"]));
        }
        finally { Clean(); }
    }
}
