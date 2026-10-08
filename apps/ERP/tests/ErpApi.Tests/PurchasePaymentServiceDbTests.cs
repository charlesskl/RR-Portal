using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Payables;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchasePaymentServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PurchasePaymentService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [供应商资料] WHERE [供应商编号]=N'P6CS1') INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'P6CS1',N'P6C供应商')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new PurchasePaymentCreateDto
            {
                明细 = [
                    new PurchasePaymentLineDto { 供应商编号 = "P6CS1", 供应商名称 = "P6C供应商", 付款金额 = 30 },
                    new PurchasePaymentLineDto { 供应商编号 = "P6CS1", 供应商名称 = "P6C供应商", 付款金额 = 20 },
                ]
            }, "tester");
            Assert.StartsWith("CF", no);
            var 金额 = c.QueryFirst<decimal>("SELECT [金额] FROM [采购付款单] WHERE [单号]=@no", new { no });
            Assert.Equal(50m, 金额);

            c.Execute("UPDATE [采购付款单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [采购付款单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [采购付款明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [采购付款单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'P6CS1'");
        }
    }
}
