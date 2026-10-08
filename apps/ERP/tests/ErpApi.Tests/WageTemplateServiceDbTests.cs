using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class WageTemplateServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private WageTemplateService Svc() => new(Factory());

    [SkippableFact]
    public async Task Save_整组替换_then_Get_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号]=N'P7CT1'");
            c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号]=N'P7CT1'");
        }
        Clean();
        try
        {
            await Svc().SaveAsync(new WageTemplateSaveDto
            {
                模板编号 = "P7CT1", 模板名称 = "车间模板",
                明细 = [
                    new() { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" },
                    new() { 台头项目 = "计件工资", 类型 = "应发", 公式 = "计件工资" },
                    new() { 台头项目 = "社保费", 类型 = "应扣", 公式 = "社保费" },
                    new() { 台头项目 = "实发合计", 类型 = "合计", 公式 = "基本工资+计件工资-社保费" },
                ]
            }, "tester");
            var d = await Svc().GetAsync("P7CT1");
            Assert.NotNull(d);
            Assert.Equal("车间模板", d!.模板名称);
            Assert.Equal(4, d.明细.Count);
            Assert.Equal(1, d.明细[0].序号);
            Assert.Equal("实发合计", d.明细[3].台头项目);
            Assert.Equal("基本工资+计件工资-社保费", d.明细[3].公式);
            Assert.Equal("应扣", d.明细[2].类型);

            // 整组替换为2项
            await Svc().SaveAsync(new WageTemplateSaveDto
            { 模板编号 = "P7CT1", 模板名称 = "车间模板V2", 明细 = [
                new() { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" },
                new() { 台头项目 = "实发合计", 类型 = "合计", 公式 = "基本工资" } ] }, "tester");
            var d2 = await Svc().GetAsync("P7CT1");
            Assert.Equal(2, d2!.明细.Count);
            Assert.Equal("车间模板V2", d2.模板名称);

            Assert.True(await Svc().DeleteAsync("P7CT1"));
            Assert.Null(await Svc().GetAsync("P7CT1"));
        }
        finally { Clean(); }
    }
}
