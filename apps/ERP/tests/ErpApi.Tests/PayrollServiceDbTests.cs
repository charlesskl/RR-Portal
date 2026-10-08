using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PayrollServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private static PayrollService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Generate_类型驱动合计_动态ZG列_可重算()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [工资明细表] WHERE [月份]=N'202605' AND [部门编号]=N'P7DD1'");
            c.Execute("DELETE FROM [工资总表] WHERE [月份]=N'202605' AND [部门编号]=N'P7DD1'");
            c.Execute("DELETE FROM [工资表项目公式] WHERE [月份]=N'202605' AND [部门编号]=N'P7DD1'");
            c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号]=N'P7DT1'");
            c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号]=N'P7DT1'");
            c.Execute("DELETE FROM [计件表] WHERE [员工号]=N'P7DE1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P7DE1'");
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=N'P7DD1'");
        }
        Clean();
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(N'P7DD1',N'车间')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号],[职称],[基本工资],[在职]) VALUES(N'P7DE1',N'张三',N'P7DD1',N'工人',1000,N'1')");
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7DE1',N'01',1,500,500,'2026-05-10','1','1')");
        // 工资模板 P7DT1：4 项
        var 项 = new (int 序号, string 台头项目, string 类型, string 公式)[]
        {
            (1, "基本工资", "应发", "基本工资"),
            (2, "计件工资", "应发", "计件工资"),
            (3, "满勤奖", "应发", "实出勤天数/应出勤天数*260"),
            (4, "社保", "应扣", "100"),
        };
        foreach (var (序号, 台头项目, 类型, 公式) in 项)
        {
            c.Execute("INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型]) VALUES(N'P7DT1',N'车间模板',@序号,@台头项目,@类型)",
                new { 序号, 台头项目, 类型 });
            c.Execute("INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式]) VALUES(N'P7DT1',N'车间模板',NULL,NULL,@序号,@台头项目,@公式)",
                new { 序号, 台头项目, 公式 });
        }
        try
        {
            var no = await Svc().GenerateAsync(
                new PayrollGenerateDto { 月份 = "202605", 部门编号 = "P7DD1", 模板编号 = "P7DT1", 应出勤天数 = 26 }, "tester");
            Assert.False(string.IsNullOrWhiteSpace(no));

            var row = await c.QueryFirstAsync(
                "SELECT [基本工资],[计件工资],[应发合计],[应扣合计],[实发合计] FROM [工资明细表] WHERE [工资表编号]=@no AND [编号]=N'P7DE1'",
                new { no });
            Assert.Equal(1000m, (decimal)row.基本工资);
            Assert.Equal(500m, (decimal)row.计件工资);
            Assert.Equal(1760m, (decimal)row.应发合计);   // 1000+500+260（满勤 26/26*260=260）
            Assert.Equal(100m, (decimal)row.应扣合计);
            Assert.Equal(1660m, (decimal)row.实发合计);

            // 工资总表 Σ
            var 实发 = await c.ExecuteScalarAsync<decimal>(
                "SELECT [实发合计] FROM [工资总表] WHERE [工资表编号]=@no", new { no });
            Assert.Equal(1660m, 实发);

            // 可重算：再生成一次 → 该月+部门仍恰好 1 行明细
            var no2 = await Svc().GenerateAsync(
                new PayrollGenerateDto { 月份 = "202605", 部门编号 = "P7DD1", 模板编号 = "P7DT1", 应出勤天数 = 26 }, "tester");
            var cnt = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [工资明细表] WHERE [月份]=N'202605' AND [部门编号]=N'P7DD1'");
            Assert.Equal(1, cnt);
            var cntZong = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [工资总表] WHERE [月份]=N'202605' AND [部门编号]=N'P7DD1'");
            Assert.Equal(1, cntZong);
        }
        finally { Clean(); }
    }
}
