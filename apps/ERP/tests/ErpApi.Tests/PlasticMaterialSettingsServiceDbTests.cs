using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.MaterialSettings;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class PlasticMaterialSettingsServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PlasticMaterialSettingsService Svc(IAuditLogger? audit = null)
        => new(Factory(), audit ?? new RecordingAuditLogger());

    private static PlasticMaterialSettingSaveDto ValidDto() => new()
    {
        默认仓库 = "仓库一",
        损耗率 = 2.5m,
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
SELECT CASE WHEN OBJECT_ID(N'[塑胶物料设置]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[塑胶物料资料]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 未应用塑胶物料设置迁移(53号脚本)");
        }
        return c;
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶物料设置] WHERE [物料编号] IN (N'PLS-MAT-1',N'PLS-MISSING')");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号] = N'PLS-MAT-1'");
    }

    [Fact]
    public async Task Upsert_rejects_invalid_input_before_opening_database()
    {
        var service = new PlasticMaterialSettingsService(new NeverOpenConnectionFactory(), new RecordingAuditLogger());

        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync(" ", ValidDto(), "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync(new string('C', 81), ValidDto(), "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PLS-MAT-1", ValidDto(), " "));

        var longWarehouse = ValidDto(); longWarehouse.默认仓库 = new string('X', 81);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PLS-MAT-1", longWarehouse, "tester"));

        var longRemark = ValidDto(); longRemark.备注 = new string('X', 501);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PLS-MAT-1", longRemark, "tester"));

        var negativeRate = ValidDto(); negativeRate.损耗率 = -1;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PLS-MAT-1", negativeRate, "tester"));

        var badRate = ValidDto(); badRate.损耗率 = 100.01m;
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpsertAsync("PLS-MAT-1", badRate, "tester"));
    }

    [SkippableFact]
    public async Task Upsert_list_and_delete_roundtrip()
    {
        using var c = OpenSchemaOrSkip(fx);
        Cleanup(c);
        try
        {
            c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES (N'PLS-MAT-1',N'物料一',N'S1',N'个')");

            await Assert.ThrowsAsync<KeyNotFoundException>(() => Svc().UpsertAsync("PLS-MISSING", ValidDto(), "tester"));

            var created = await Svc().UpsertAsync("PLS-MAT-1", ValidDto(), "tester");
            Assert.NotNull(created.ID);
            Assert.Equal("仓库一", created.默认仓库);
            Assert.Equal(2.5m, created.损耗率);
            Assert.Equal("物料一", created.物料名称);

            var changed = ValidDto();
            changed.默认仓库 = "仓库二";
            changed.损耗率 = null;
            var updated = await Svc().UpsertAsync("PLS-MAT-1", changed, "tester2");
            Assert.Equal(created.ID, updated.ID);
            Assert.Equal("仓库二", updated.默认仓库);
            Assert.Null(updated.损耗率);
            Assert.Equal("tester2", updated.操作员);

            var list = await Svc().ListAsync(1, 20, "PLS-MAT-1");
            Assert.Single(list.Items);
            Assert.Equal("仓库二", list.Items.Single().默认仓库);

            Assert.True(await Svc().DeleteAsync("PLS-MAT-1", "tester"));
            Assert.False(await Svc().DeleteAsync("PLS-MAT-1", "tester"));

            var afterDelete = await Svc().ListAsync(1, 20, "PLS-MAT-1");
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
