using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesReceiptServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SalesReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6BC1') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6BC1',N'P6B客户')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new SalesReceiptCreateDto
            {
                明细 = [
                    new SalesReceiptLineDto { 客户编号 = "P6BC1", 客户名称 = "P6B客户", 收款金额 = 30 },
                    new SalesReceiptLineDto { 客户编号 = "P6BC1", 客户名称 = "P6B客户", 收款金额 = 20 },
                ]
            }, "tester");
            Assert.StartsWith("XK", no);
            var 金额 = c.QueryFirst<decimal>("SELECT [金额] FROM [销售收款单] WHERE [单号]=@no", new { no });
            Assert.Equal(50m, 金额);

            c.Execute("UPDATE [销售收款单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [销售收款单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6BC1'");
        }
    }
}
