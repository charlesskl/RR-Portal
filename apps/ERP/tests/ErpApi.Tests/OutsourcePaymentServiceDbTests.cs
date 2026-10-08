using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Payables;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OutsourcePaymentServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private OutsourcePaymentService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [加工厂资料] WHERE [加工厂编号]=N'P6CF1') INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P6CF1',N'P6C加工厂')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new OutsourcePaymentCreateDto
            {
                明细 = [
                    new OutsourcePaymentLineDto { 加工厂编号 = "P6CF1", 加工厂名称 = "P6C加工厂", 付款金额 = 30 },
                    new OutsourcePaymentLineDto { 加工厂编号 = "P6CF1", 加工厂名称 = "P6C加工厂", 付款金额 = 20 },
                ]
            }, "tester");
            Assert.StartsWith("FF", no);
            var 金额 = c.QueryFirst<decimal>("SELECT [金额] FROM [发外加工付款单] WHERE [单号]=@no", new { no });
            Assert.Equal(50m, 金额);

            c.Execute("UPDATE [发外加工付款单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [发外加工付款单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [发外加工付款明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [发外加工付款单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'P6CF1'");
        }
    }
}
