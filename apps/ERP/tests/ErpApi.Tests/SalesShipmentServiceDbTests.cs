using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesShipmentServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SalesShipmentService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6AC1') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6AC1',N'P6A客户')");
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'P6AM1') INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'P6AM1',N'成品甲')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new SalesShipmentCreateDto
            {
                仓库 = "P6A仓", 客户编号 = "P6AC1", 客户名称 = "P6A客户",
                明细 = [
                    new SalesShipmentLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 10, 单价 = 8 },
                    new SalesShipmentLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "L", 颜色 = "白", 单位 = "件", 数量 = 5, 单价 = 8 },
                ]
            }, "tester");
            Assert.StartsWith("XS", no);
            var h = c.QueryFirst<(decimal 数量, decimal 金额)>("SELECT [数量],[金额] FROM [销售出货单] WHERE [单号]=@no", new { no });
            Assert.Equal(15m, h.数量);
            Assert.Equal(120m, h.金额);  // 10*8 + 5*8

            // 审核后不可删
            c.Execute("UPDATE [销售出货单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [销售出货单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6AC1'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P6AM1'");
        }
    }
}
