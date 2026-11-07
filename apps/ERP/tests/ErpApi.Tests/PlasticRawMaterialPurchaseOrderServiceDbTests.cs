using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialPurchaseOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [c操作记录] WHERE [表名]=N'原料采购订单' AND EXISTS(SELECT 1 FROM [原料采购订单] p WHERE p.[供应商名称]=N'YCD测试供应商' AND [c操作记录].[操作记录] LIKE N'单号='+p.[单号]+N'%')");
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [原料编号]=N'YCD-PM'");
        c.Execute("DELETE FROM [原料采购订单] WHERE [供应商名称]=N'YCD测试供应商'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'YCD-PM'");
    }

    private static void Seed(SqlConnection c) => c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[常用原料]) VALUES(N'YCD-PM',N'ABS粒',N'KG',1)");

    private static PlasticRawMaterialPurchaseOrderCreateDto MakeDto() => new()
    {
        供应商编号 = "S01",
        供应商名称 = "YCD测试供应商",
        明细 =
        {
            new() { 原料编号 = "YCD-PM", 原料名称 = "ABS粒", 规格 = "规X", 单位 = "kg", 单价类型 = "含税", 订货数量 = 5, 单价 = 3 },
            new() { 原料编号 = "YCD-PM", 原料名称 = "ABS粒", 规格 = "规X", 单位 = "kg", 单价类型 = "含税", 订货数量 = 3, 单价 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_and_amount()
    {
        using var c = fx.Open(); Clean(c);
        using var identity = new CloudRawFixture(c, fx.ConnectionString!);
        try
        {
            Seed(c);
            var 单号 = await Svc().CreateAsync(MakeDto(), identity.Clerk);
            Assert.StartsWith("YCD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(24m, d.单头!.金额);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("YCD-PM", d.明细[0].原料编号);
            Assert.Equal("含税", d.明细[0].单价类型);
            Assert.Equal(15m, d.明细[0].金额);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Clean(c);
        using var identity = new CloudRawFixture(c, fx.ConnectionString!);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            Seed(c);
            var 单号 = await Svc().CreateAsync(MakeDto(), identity.Clerk);
            c.Execute("UPDATE [原料采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@单号",new {单号});
            Assert.True(await engine.ApproveAsync("原料采购订单", 单号, identity.Clerk));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料采购订单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c);
        using var identity = new CloudRawFixture(c, fx.ConnectionString!);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            Seed(c);
            var 单号 = await Svc().CreateAsync(MakeDto(), identity.Clerk);
            c.Execute("UPDATE [原料采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@单号",new {单号});
            Assert.True(await engine.ApproveAsync("原料采购订单", 单号, identity.Clerk));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号, identity.Clerk));
        }
        finally { Clean(c); }
    }
}
