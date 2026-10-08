using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Materials.PurchaseSettings;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class PurchaseMaterialSettingsServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseMaterialSettingsService Svc(IAuditLogger? audit = null)
        => new(Factory(), audit ?? new RecordingAuditLogger());

    private static PurchaseMaterialSettingSaveDto ValidDto() => new()
    {
        默认供应商 = "供应商一",
        最小订量 = 100,
        采购损耗率 = 2.5m,
        备注 = "initial"
    };

    private static SqlConnection OpenSchemaOrSkip(DbFixture fx)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB，跳过数据库集成测试");
        var c = new SqlConnection(fx.ConnectionString);
        try { c.Open(); }
        catch (SqlException ex)
        {
            c.Dispose();
            Skip.If(true, $"ERP_TEST_DB 无法连接: {ex.Message}");
        }
        var available = c.ExecuteScalar<int>(@"
SELECT CASE WHEN OBJECT_ID(N'[采购物料设置]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[物料资料]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 未应用采购物料设置迁移(52号脚本)");
        }
        return c;
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购物料设置] WHERE [物料编号] IN (N'PMS-MAT-1',N'PMS-MISSING')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] = N'PMS-MAT-1'");
    }

    [Fact]
    public async Task Upsert_rejects_invalid_input_before_opening_database()
    {
        var service = new PurchaseMaterialSettingsService(new NeverOpenConnectionFactory(), new RecordingAuditLogger());

        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync(" ", ValidDto(), "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync(new string('C', 81), ValidDto(), "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PMS-MAT-1", ValidDto(), " "));

        var longSupplier = ValidDto(); longSupplier.默认供应商 = new string('X', 161);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PMS-MAT-1", longSupplier, "tester"));

        var longRemark = ValidDto(); longRemark.备注 = new string('X', 501);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PMS-MAT-1", longRemark, "tester"));

        var negativeQty = ValidDto(); negativeQty.最小订量 = -1;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PMS-MAT-1", negativeQty, "tester"));

        var badRate = ValidDto(); badRate.采购损耗率 = 100.01m;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PMS-MAT-1", badRate, "tester"));
    }

    [SkippableFact]
    public async Task Upsert_list_and_delete_roundtrip()
    {
        using var c = OpenSchemaOrSkip(fx);
        Cleanup(c);
        try
        {
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES (N'PMS-MAT-1',N'物料一',N'S1',N'个')");

            await Assert.ThrowsAsync<KeyNotFoundException>(() => Svc().UpsertAsync("PMS-MISSING", ValidDto(), "tester"));

            var created = await Svc().UpsertAsync("PMS-MAT-1", ValidDto(), "tester");
            Assert.NotNull(created.ID);
            Assert.Equal("供应商一", created.默认供应商);
            Assert.Equal(100m, created.最小订量);
            Assert.Equal(2.5m, created.采购损耗率);
            Assert.Equal("物料一", created.物料名称);

            var changed = ValidDto();
            changed.默认供应商 = "供应商二";
            changed.采购损耗率 = null;
            var updated = await Svc().UpsertAsync("PMS-MAT-1", changed, "tester2");
            Assert.Equal(created.ID, updated.ID);
            Assert.Equal("供应商二", updated.默认供应商);
            Assert.Null(updated.采购损耗率);
            Assert.Equal("tester2", updated.操作员);

            var list = await Svc().ListAsync(1, 20, "PMS-MAT-1");
            Assert.Single(list.Items);
            Assert.Equal("供应商二", list.Items.Single().默认供应商);

            Assert.True(await Svc().DeleteAsync("PMS-MAT-1", "tester"));
            Assert.False(await Svc().DeleteAsync("PMS-MAT-1", "tester"));

            var afterDelete = await Svc().ListAsync(1, 20, "PMS-MAT-1");
            Assert.Single(afterDelete.Items);
            Assert.Null(afterDelete.Items.Single().ID);
        }
        finally { Cleanup(c); }
    }

    private sealed class NeverOpenConnectionFactory : ISqlConnectionFactory
    {
        public string GetConnectionString() => throw new Xunit.Sdk.XunitException("参数校验不应读取数据库连接字符串。");
        public SqlConnection Create() => throw new Xunit.Sdk.XunitException("参数校验不应创建数据库连接。");
    }

    private sealed class RecordingAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null)
            => Task.CompletedTask;
    }
}
