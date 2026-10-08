using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticIssueFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticIssueCreateDto
        {
            领料部门 = "注塑车间", 领料人 = "张三", 仓库 = "塑胶仓",
            胶箱数 = 2, 纸箱数 = 1, 钙塑箱数 = 3, 卡板数 = 4, 收件人 = "李四", 电脑单号 = "PC-01", 领料备注 = "生产领料",
            明细 =
            [
                new PlasticIssueCreateLineDto
                {
                    装配采购 = "是", 生产单号 = "MO-001", 款号 = "K100", 物料编号 = "PIFM01", 模具编号 = "MJ-9",
                    物料名称 = "ABS粒", 规格 = "规A", 颜色 = "黑", 色粉号 = "S5", 用料名称 = "外壳料", 单位 = "kg", 数量 = 8, 单价 = 5
                }
            ]
        }, "tester");
        try
        {
            Assert.StartsWith("SLL", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal(2, d!.单头!.胶箱数);
            Assert.Equal("李四", d.单头!.收件人);
            Assert.Equal("PC-01", d.单头!.电脑单号);
            Assert.Equal("生产领料", d.单头!.领料备注);
            var l = Assert.Single(d.明细);
            Assert.Equal("是", l.装配采购);
            Assert.Equal("MO-001", l.生产单号);
            Assert.Equal("MJ-9", l.模具编号);
            Assert.Equal("S5", l.色粉号);
            Assert.Equal("外壳料", l.用料名称);
            Assert.Equal(8m, l.数量);
        }
        finally { c.Execute("DELETE FROM [塑胶领料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶领料单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
