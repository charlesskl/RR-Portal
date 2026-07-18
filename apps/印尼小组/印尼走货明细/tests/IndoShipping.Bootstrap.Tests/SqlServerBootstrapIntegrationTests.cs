using System.Text.Json.Nodes;
using IndoShipping.Bootstrap;
using Microsoft.Data.SqlClient;
using Xunit;

namespace IndoShipping.Bootstrap.Tests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SqlServerIntegrationCollection
{
    public const string Name = "SQL Server integration";
}

[Collection(SqlServerIntegrationCollection.Name)]
public sealed class SqlServerBootstrapIntegrationTests
{
    private const string SeedVersion = "2026-07-15";
    private const string AppPassword = "Integration-App!2026-Strong";
    private const string AdminPassword = "Integration-Admin!2026-Strong";

    [SqlServerIntegrationFact]
    public async Task Lifecycle_Is_Idempotent_Concurrent_Retryable_And_Protects_Existing_Users()
    {
        var saConnection = Environment.GetEnvironmentVariable("INDO_SQL_TEST_CONNECTION")!;
        var snapshot = SeedSnapshot.Load(TestPaths.SeedJson);
        var badSnapshotPath = await CreateFailingSnapshot();
        var badSnapshot = SeedSnapshot.Load(badSnapshotPath);
        var targets = new[] { NewTarget("retry"), NewTarget("concurrent"), NewTarget("users") };

        try
        {
            var retryBootstrap = new BootstrapDatabase(saConnection, targets[0]);
            await Assert.ThrowsAnyAsync<SqlException>(() => Run(retryBootstrap, badSnapshot));
            Assert.Equal(0, await CountRows(saConnection, targets[0], "customers"));
            Assert.False(await MarkerExists(saConnection, targets[0]));

            Assert.True(await Run(retryBootstrap, snapshot));
            await AssertHistoricalValues(saConnection, targets[0]);
            Assert.False(await Run(retryBootstrap, snapshot));

            var concurrentRuns = await Task.WhenAll(
                Run(new BootstrapDatabase(saConnection, targets[1]), snapshot),
                Run(new BootstrapDatabase(saConnection, targets[1]), snapshot));
            Assert.Single(concurrentRuns.Where(imported => imported));
            Assert.Single(concurrentRuns.Where(imported => !imported));
            await AssertHistoricalValues(saConnection, targets[1]);

            var usersBootstrap = new BootstrapDatabase(saConnection, targets[2]);
            await Assert.ThrowsAnyAsync<SqlException>(() => Run(usersBootstrap, badSnapshot));
            await AddRealUser(saConnection, targets[2]);
            var refusal = await Assert.ThrowsAsync<InvalidOperationException>(() => Run(usersBootstrap, snapshot));
            Assert.Contains("Users", refusal.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(0, await CountRows(saConnection, targets[2], "customers"));
            Assert.False(await MarkerExists(saConnection, targets[2]));
        }
        finally
        {
            foreach (var target in targets.Reverse())
                await DropTarget(saConnection, target);
            File.Delete(badSnapshotPath);
        }
    }

    private static Task<bool> Run(BootstrapDatabase bootstrap, SeedSnapshot snapshot) =>
        bootstrap.RunAsync(
            TestPaths.SchemaSql,
            snapshot,
            SeedVersion,
            AppPassword,
            AdminPassword,
            TimeSpan.FromMinutes(5));

    private static BootstrapTarget NewTarget(string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..12];
        return new BootstrapTarget(
            $"IndoShipping_it_{label}_{suffix}",
            $"indoshipping_it_{label}_{suffix}",
            $"rr:IndoShipping:integration:{label}:{suffix}");
    }

    private static async Task<string> CreateFailingSnapshot()
    {
        var root = JsonNode.Parse(await File.ReadAllTextAsync(TestPaths.SeedJson))!;
        root["tables"]!["customers"]![0]!["name"] = null;
        var path = Path.Combine(Path.GetTempPath(), $"indo-shipping-bad-seed-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(path, root.ToJsonString());
        return path;
    }

    private static async Task AssertHistoricalValues(string saConnection, BootstrapTarget target)
    {
        await using var connection = new SqlConnection(WithDatabase(saConnection, target.DatabaseName));
        await connection.OpenAsync();

        await using (var material = new SqlCommand("SELECT usage_qty FROM dbo.materials WHERE id = 127", connection))
            Assert.Equal(1m, Convert.ToDecimal(await material.ExecuteScalarAsync()));

        await using var item = new SqlCommand("""
SELECT material_name, category, spec, usage_qty, ordered_qty, material_qty,
       spoilage_qty, purchase_qty, purchase_unit
FROM dbo.po_items WHERE id = 625
""", connection);
        await using var reader = await item.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("Synthetic fastener", reader.GetString(0));
        Assert.Equal("Hardware", reader.GetString(1));
        Assert.Equal("2.6x12", reader.GetString(2));
        Assert.Equal(1m, reader.GetDecimal(3));
        Assert.Equal(240m, reader.GetDecimal(4));
        Assert.Equal(240m, reader.GetDecimal(5));
        Assert.Equal(0m, reader.GetDecimal(6));
        Assert.Equal(240m, reader.GetDecimal(7));
        Assert.Equal("KGM", reader.GetString(8));
    }

    private static async Task AddRealUser(string saConnection, BootstrapTarget target)
    {
        await using var connection = new SqlConnection(WithDatabase(saConnection, target.DatabaseName));
        await connection.OpenAsync();
        await using var command = new SqlCommand("""
INSERT INTO dbo.Users (Username, PasswordHash, DisplayName, Userbqrpower, Usereditpower)
VALUES (N'existing-user', N'existing-real-hash', N'Existing User', '100000000', '100000000')
""", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<long> CountRows(string saConnection, BootstrapTarget target, string table)
    {
        await using var connection = new SqlConnection(WithDatabase(saConnection, target.DatabaseName));
        await connection.OpenAsync();
        await using var command = new SqlCommand($"SELECT COUNT_BIG(*) FROM dbo.[{table}]", connection);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private static async Task<bool> MarkerExists(string saConnection, BootstrapTarget target)
    {
        await using var connection = new SqlConnection(WithDatabase(saConnection, target.DatabaseName));
        await connection.OpenAsync();
        await using var table = new SqlCommand("SELECT OBJECT_ID(N'dbo.__rr_seed_history', N'U')", connection);
        if (await table.ExecuteScalarAsync() is not int)
            return false;

        await using var marker = new SqlCommand(
            "SELECT COUNT(*) FROM dbo.__rr_seed_history WHERE [version] = N'2026-07-15'",
            connection);
        return Convert.ToInt32(await marker.ExecuteScalarAsync()) == 1;
    }

    private static async Task DropTarget(string saConnection, BootstrapTarget target)
    {
        await using var connection = new SqlConnection(WithDatabase(saConnection, "master"));
        await connection.OpenAsync();
        var database = Quote(target.DatabaseName);
        var login = Quote(target.AppLogin);
        await using var command = new SqlCommand($"""
IF DB_ID(@databaseName) IS NOT NULL
BEGIN
    ALTER DATABASE {database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE {database};
END
IF SUSER_ID(@loginName) IS NOT NULL
    DROP LOGIN {login};
""", connection);
        command.Parameters.AddWithValue("@databaseName", target.DatabaseName);
        command.Parameters.AddWithValue("@loginName", target.AppLogin);
        await command.ExecuteNonQueryAsync();
    }

    private static string WithDatabase(string connectionString, string database)
    {
        var builder = new SqlConnectionStringBuilder(connectionString) { InitialCatalog = database };
        return builder.ConnectionString;
    }

    private static string Quote(string identifier) => $"[{identifier.Replace("]", "]]", StringComparison.Ordinal)}]";
}

public sealed class SqlServerIntegrationFactAttribute : FactAttribute
{
    public SqlServerIntegrationFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("INDO_SQL_TEST_CONNECTION")))
            Skip = "Set INDO_SQL_TEST_CONNECTION to run the disposable SQL Server lifecycle harness.";
    }
}
