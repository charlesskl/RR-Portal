using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Outsourcing;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OutsourceReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OutsourceService Out() => new(Factory(), new DocumentNumberGenerator());
    private OutsourceReturnService Ret() => new(Factory(), new DocumentNumberGenerator());

    private static OutsourceCreateDto OutDto() => new()
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 = [ new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 100 } ]
    };

    [SkippableFact]
    public async Task Basis_then_receive_computes_owed_and_amount()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 发外单号 = await Out().CreateAsync(OutDto(), "tester");
        c.Execute("UPDATE [发外加工单] SET [审核]='1' WHERE [单号]=@n", new { n = 发外单号 });
        string? 回收单号 = null;
        try
        {
            var basis = await Ret().BasisAsync(发外单号);
            Assert.Single(basis);
            Assert.Equal(100m, basis[0].发外数量);
            Assert.Equal(0m, basis[0].已回收);
            Assert.Equal(100m, basis[0].欠数);
            Assert.Equal(2.5m, basis[0].单价);

            回收单号 = await Ret().CreateAsync(new OutsourceReturnCreateDto
            {
                发外单号 = 发外单号, 加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                明细 = [ new OutsourceReturnLineDto {
                    生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
                    加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 发外数量 = 100, 回收数量 = 95 } ]
            }, "tester");

            Assert.StartsWith("FH", 回收单号);
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [欠数] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>("SELECT [单价] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(237.5m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(95m, c.ExecuteScalar<decimal>("SELECT [回收数量] FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [相差数量] FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 }));

            c.Execute("UPDATE [发外回收单] SET [审核]='1' WHERE [单号]=@n", new { n = 回收单号 });
            var basis2 = await Ret().BasisAsync(发外单号);
            Assert.Equal(95m, basis2[0].已回收);
            Assert.Equal(5m, basis2[0].欠数);
        }
        finally
        {
            if (回收单号 != null)
            {
                c.Execute("DELETE FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 });
                c.Execute("DELETE FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 });
            }
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 发外单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 发外单号 });
            P4M7TestData.Cleanup(c);
        }
    }
}
