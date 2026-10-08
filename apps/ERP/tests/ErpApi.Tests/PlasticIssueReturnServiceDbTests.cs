using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticIssue;
using ErpApi.Features.Plastics.PlasticReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticIssueReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticIssueService IssueSvc() => new(Factory(), new DocumentNumberGenerator());
    private PlasticReturnService ReturnSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Issue_Create_Get_金额_Delete()
    {
        using var c = fx.Open();
        var 单号 = await IssueSvc().CreateAsync(new PlasticIssueCreateDto
        {
            领料部门 = "注塑车间", 领料人 = "张三", 仓库 = "塑胶仓",
            明细 = [ new PlasticIssueCreateLineDto { 物料编号 = "SLLPM01", 物料名称 = "ABS粒", 单位 = "kg", 数量 = 8, 单价 = 5 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SLL", 单号);
            var d = await IssueSvc().GetAsync(单号);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(40m, d.单头!.金额);
            Assert.Equal("注塑车间", d.单头!.领料部门);
            Assert.True(await IssueSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶领料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶领料单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Return_Create_Get_Delete_with_STL_prefix()
    {
        using var c = fx.Open();
        var 单号 = await ReturnSvc().CreateAsync(new PlasticReturnCreateDto
        {
            退料部门 = "注塑车间", 退料人 = "李四", 仓库 = "塑胶仓",
            明细 = [ new PlasticReturnCreateLineDto { 物料编号 = "STLPM01", 物料名称 = "PP粒", 单位 = "kg", 数量 = 3, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STL", 单号);
            var d = await ReturnSvc().GetAsync(单号);
            Assert.Equal(18m, d!.单头!.金额);
            Assert.Equal("李四", d.单头!.退料人);
            Assert.True(await ReturnSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶退料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退料单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => IssueSvc().CreateAsync(new PlasticIssueCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => ReturnSvc().CreateAsync(new PlasticReturnCreateDto { 仓库 = "", 明细 = [ new PlasticReturnCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
}
