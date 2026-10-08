using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Features.Warehouse.Semi.Labels;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 装配类别决定仓别：成品入仓单产品来源只列 类别=成品；半成品入仓单产品来源排除 类别=成品；
// 未设置装配扩展（无类别）的款号两边都保持现状出现。
[Collection("db")]
public sealed class AssemblyCategoryWarehouseFilterDbTests(DbFixture fx)
{
    private static readonly string[] 款号列表 = ["WCAT-FIN", "WCAT-SEMI", "WCAT-NONE"];

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private FinishedReceiptService FinishedSvc() => new(Factory(), new DocumentNumberGenerator());
    private SemiFinishedLabelOrderService SemiSvc()
        => new(Factory(), new DocumentNumberGenerator(), new NoOpAuditLogger());

    private SqlConnection OpenOrSkip()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var c = fx.Open();
        var available = c.ExecuteScalar<int>(@"
SELECT CASE WHEN OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[款号物料总表]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[款号总表]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 未应用装配共用物料设置迁移");
        }
        return c;
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] LIKE N'WCAT-%'");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] LIKE N'WCAT-%'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] LIKE N'WCAT-%'");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        foreach (var 款号 in 款号列表)
        {
            c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(@款号,N'类别测试')", new { 款号 });
            c.Execute(@"
INSERT INTO [款号物料总表]([日期],[客户名称],[产品编号],[款号],[款式])
VALUES('2026-07-28',N'客户',@产品编号,@款号,N'类别测试')",
                new { 款号, 产品编号 = $"PART-{款号}" });
        }
        c.Execute("INSERT INTO [半成品共用物料设置]([产品货号],[类别]) VALUES(N'WCAT-FIN',N'成品')");
        c.Execute("INSERT INTO [半成品共用物料设置]([产品货号],[类别]) VALUES(N'WCAT-SEMI',N'半成品')");
    }

    [SkippableFact]
    public async Task Finished_receipt_products_only_list_finished_category()
    {
        using var c = OpenOrSkip();
        Seed(c);
        try
        {
            var result = await FinishedSvc().ProductsAsync(
                new FinishedReceiptProductQuery { Size = 50, Keyword = "WCAT-" });
            var 货号 = result.Items.Select(i => i.产品货号).ToList();

            Assert.Contains("WCAT-FIN", 货号);
            Assert.Contains("WCAT-NONE", 货号);
            Assert.DoesNotContain("WCAT-SEMI", 货号);
        }
        finally
        {
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Semi_receipt_products_exclude_finished_category()
    {
        using var c = OpenOrSkip();
        Seed(c);
        try
        {
            var result = await SemiSvc().ProductsAsync(
                new SemiFinishedLabelProductQuery { Size = 50, Keyword = "WCAT-" }, canSeePrice: true);
            var 货号 = result.Items.Select(i => i.产品货号).ToList();

            Assert.Contains("WCAT-SEMI", 货号);
            Assert.Contains("WCAT-NONE", 货号);
            Assert.DoesNotContain("WCAT-FIN", 货号);
        }
        finally
        {
            Cleanup(c);
        }
    }

    private sealed class NoOpAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null)
            => Task.CompletedTask;
    }
}
