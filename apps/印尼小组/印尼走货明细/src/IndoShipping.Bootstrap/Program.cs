using System.Data;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace IndoShipping.Bootstrap;

public static class Program
{
    private const string SeedVersion = "2026-07-15";

    public static async Task<int> Main()
    {
        try
        {
            if (string.Equals(Environment.GetEnvironmentVariable("INDO_SQL_ROTATE_SA"), "1", StringComparison.Ordinal))
            {
                var oldSaPassword = BootstrapSecrets.DecodeRequired("INDO_SQL_OLD_SA_PASSWORD_B64");
                var newSaPassword = BootstrapSecrets.DecodeRequired("INDO_SQL_SA_PASSWORD_B64");
                var rotator = new SaPasswordRotator(BootstrapSecrets.BuildSaConnection(oldSaPassword));
                await rotator.RotateAsync(newSaPassword);
                Console.WriteLine("IndoShipping SA password rotation completed.");
                return 0;
            }

            var secrets = BootstrapSecrets.FromEnvironment();
            var schemaPath = AssetPath("db", "rebuild_schema.sql");
            var seedPath = AssetPath("seed", "business-data.json");
            var snapshot = SeedSnapshot.Load(seedPath);

            if (!string.Equals(snapshot.SchemaVersion, SeedVersion, StringComparison.Ordinal))
                throw new InvalidDataException($"Expected snapshot version {SeedVersion}, got {snapshot.SchemaVersion}.");

            var bootstrap = new BootstrapDatabase(secrets.SaConnection);
            var imported = await bootstrap.RunAsync(
                schemaPath,
                snapshot,
                SeedVersion,
                secrets.AppPassword,
                secrets.AdminPassword,
                TimeSpan.FromMinutes(5));

            Console.WriteLine(imported
                ? $"IndoShipping bootstrap imported snapshot {SeedVersion}."
                : $"IndoShipping snapshot {SeedVersion} was already imported; seed skipped.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"IndoShipping bootstrap failed: {exception.Message}");
            return 1;
        }
    }

    private static string AssetPath(params string[] parts)
    {
        var path = parts.Aggregate(AppContext.BaseDirectory, Path.Combine);
        return File.Exists(path)
            ? path
            : throw new FileNotFoundException($"Bootstrap asset was not found: {string.Join('/', parts)}", path);
    }
}

public sealed record BootstrapSecrets(string SaConnection, string AppPassword, string AdminPassword)
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static BootstrapSecrets FromEnvironment() => FromBase64(
        Required("INDO_SQL_SA_PASSWORD_B64"),
        Required("INDO_SQL_APP_PASSWORD_B64"),
        Required("INDO_SHIPPING_ADMIN_PASSWORD_B64"));

    public static BootstrapSecrets FromBase64(
        string saPasswordBase64,
        string appPasswordBase64,
        string adminPasswordBase64)
    {
        var saPassword = Decode(saPasswordBase64, "INDO_SQL_SA_PASSWORD_B64");
        return new BootstrapSecrets(
            BuildSaConnection(saPassword),
            Decode(appPasswordBase64, "INDO_SQL_APP_PASSWORD_B64"),
            Decode(adminPasswordBase64, "INDO_SHIPPING_ADMIN_PASSWORD_B64"));
    }

    public static string DecodeRequired(string name) => Decode(Required(name), name);

    public static string BuildSaConnection(string password) => new SqlConnectionStringBuilder
    {
        DataSource = "indo-sqlserver,1433",
        InitialCatalog = "master",
        UserID = "sa",
        Password = password,
        Encrypt = true,
        TrustServerCertificate = true,
        PersistSecurityInfo = false
    }.ConnectionString;

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Required environment variable {name} is missing.");

    private static string Decode(string encoded, string name)
    {
        try
        {
            var value = StrictUtf8.GetString(Convert.FromBase64String(encoded));
            return value.Length > 0
                ? value
                : throw new InvalidOperationException($"Decoded environment variable {name} is empty.");
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException($"Environment variable {name} is not valid base64.", exception);
        }
        catch (DecoderFallbackException exception)
        {
            throw new InvalidOperationException($"Environment variable {name} is not valid UTF-8.", exception);
        }
    }
}

public sealed class SaPasswordRotator(string oldSaConnection)
{
    public async Task RotateAsync(string newPassword)
    {
        ValidatePassword(newPassword);
        var oldPassword = new SqlConnectionStringBuilder(oldSaConnection).Password;

        await using var connection = new SqlConnection(oldSaConnection);
        await connection.OpenAsync();
        await using (var command = CreateCommand(connection, newPassword))
            await command.ExecuteNonQueryAsync();

        try
        {
            var verificationConnection = new SqlConnectionStringBuilder(oldSaConnection)
            {
                Password = newPassword
            }.ConnectionString;
            await using var verification = new SqlConnection(verificationConnection);
            await verification.OpenAsync();
        }
        catch (Exception verificationError)
        {
            try
            {
                await using var rollback = CreateCommand(connection, oldPassword);
                await rollback.ExecuteNonQueryAsync();
            }
            catch (Exception rollbackError)
            {
                throw new InvalidOperationException(
                    "The new SA credential could not be verified and rollback also failed.",
                    new AggregateException(verificationError, rollbackError));
            }

            throw new InvalidOperationException(
                "The new SA credential could not be verified; the old credential was restored.",
                verificationError);
        }
    }

    public static SqlCommand CreateCommand(SqlConnection connection, string newPassword)
    {
        ValidatePassword(newPassword);
        var command = new SqlCommand("""
DECLARE @statement nvarchar(max) =
    N'ALTER LOGIN [sa] WITH PASSWORD = N''' +
    REPLACE(@newPassword, N'''', N'''''') +
    N'''';
EXEC sys.sp_executesql @statement;
""", connection);
        command.Parameters.Add("@newPassword", SqlDbType.NVarChar, 128).Value = newPassword;
        return command;
    }

    private static void ValidatePassword(string password)
    {
        if (password.Length is < 1 or > 128)
            throw new ArgumentOutOfRangeException(nameof(password), "SQL Server passwords must contain 1 to 128 characters.");
    }
}

public enum SeedImportDecision
{
    Import,
    Skip
}

public enum ExistingUsersState
{
    None,
    ExpectedPlaceholder,
    ExistingData
}

public sealed record BootstrapTarget(string DatabaseName, string AppLogin, string LockResource)
{
    public static BootstrapTarget Production { get; } =
        new("IndoShipping", "indoshipping_app", "rr:IndoShipping:bootstrap");
}

internal sealed record SeedTable(string Name, bool HasIdentity, params string[] Columns);

public static partial class BootstrapSql
{
    public const string DisabledPasswordHash = "$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi";

    internal static IReadOnlyList<SeedTable> SeedTables { get; } = new SeedTable[]
    {
        new("customers", true, "id", "name", "created_at", "active"),
        new("products", false, "code", "name", "hs_cn", "hs_id", "customer", "moldings", "created_at", "updated_at", "active"),
        new("images", false, "id", "mime", "data_url", "created_at"),
        new("materials", true, "id", "product_code", "item_no", "name_zh", "name_en", "spec", "category", "material_code", "hs_cn", "hs_id", "supplier", "customs_company", "unit_kg", "gross_per_pc", "net_per_pc", "length", "width", "height", "qty_per_carton", "weight_per_carton", "image_id", "active", "sort_order", "usage_qty", "created_at"),
        new("dict_hs", true, "id", "keyword", "hs_cn", "hs_id", "priority"),
        new("dict_supplier", true, "id", "keyword", "full_name", "customs_company", "priority"),
        new("schedules", true, "id", "week_label", "upload_date", "raw_rows", "diff_from_prev", "created_at"),
        new("purchase_orders", true, "id", "po_no", "supplier", "status", "order_date", "delivery_date", "notes", "created_at"),
        new("po_items", true, "id", "po_id", "product_code", "material_id", "material_name", "qty", "price", "currency", "notes", "category", "spec", "usage_qty", "ordered_qty", "material_qty", "spoilage_qty", "purchase_qty", "purchase_unit", "tomy_po", "ship_unit", "net_per_pc", "eta"),
        new("outbound", true, "id", "po_no", "material_id", "qty", "out_date", "notes", "created_at"),
        new("shipments", true, "id", "customer", "container_no", "container_count", "ship_date", "load_date", "bl_no", "rate", "status", "created_at"),
        new("shipment_items", true, "id", "shipment_id", "material_id", "seq", "kg", "qty", "cartons", "qty_per_carton", "pallet", "price", "currency", "po_no", "po_date", "supplier", "customs_company", "bl_head", "contract_no", "contract_date", "invoice_no", "invoice_date", "invoice_price", "product_use", "formula_name"),
        new("settings", false, "key", "value", "updated_at")
    };

    public static IReadOnlyList<string> ImportColumns(string table) =>
        SeedTables.FirstOrDefault(candidate => string.Equals(candidate.Name, table, StringComparison.OrdinalIgnoreCase))?.Columns
        ?? throw new ArgumentOutOfRangeException(nameof(table), table, "Unknown seed table.");

    public static IReadOnlyList<string> SafeSchemaBatches(string sql) => SqlBatchSplitter.Split(sql)
        .Where(batch => !DestructiveStatement().IsMatch(batch))
        .Where(batch => !CreateDatabaseStatement().IsMatch(batch))
        .Where(batch => !UseDatabaseStatement().IsMatch(batch))
        .ToArray();

    public static SeedImportDecision DecideSeedImport(
        bool markerExists,
        long businessRows,
        ExistingUsersState usersState)
    {
        if (markerExists)
            return SeedImportDecision.Skip;
        if (businessRows > 0)
            throw new InvalidOperationException("Business tables contain rows without seed marker; refusing to rebuild or reseed.");
        if (usersState == ExistingUsersState.ExistingData)
            throw new InvalidOperationException("dbo.Users contains existing users without seed marker; refusing to rebuild or reseed.");
        return SeedImportDecision.Import;
    }

    [GeneratedRegex(@"\bDROP\s+(?:TABLE|DATABASE)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DestructiveStatement();

    [GeneratedRegex(@"\bCREATE\s+DATABASE\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CreateDatabaseStatement();

    [GeneratedRegex(@"^\s*USE\s+\[?IndoShipping\]?\s*;?\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UseDatabaseStatement();
}

public sealed class BootstrapDatabase
{
    private const string MarkerTable = "dbo.__rr_seed_history";

    private readonly string _masterConnection;
    private readonly string _databaseConnection;
    private readonly BootstrapTarget _target;

    public BootstrapDatabase(string saConnection, BootstrapTarget? target = null)
    {
        _target = target ?? BootstrapTarget.Production;
        ValidateTarget(_target);
        _masterConnection = WithDatabase(saConnection, "master");
        _databaseConnection = WithDatabase(saConnection, _target.DatabaseName);
    }

    public async Task<bool> RunAsync(
        string schemaPath,
        SeedSnapshot snapshot,
        string version,
        string appPassword,
        string adminPassword,
        TimeSpan timeout)
    {
        await WaitForSqlServer(timeout);
        await using var lifecycleLock = await AcquireLifecycleLock(timeout);
        try
        {
            await EnsureSchemaOnlyWhenDatabaseIsEmpty(lifecycleLock, schemaPath);
            var imported = await ImportSeedOnlyWhenMarkerMissing(snapshot, version);
            await EnsureApplicationLogin(lifecycleLock, appPassword);
            var adminHash = BCrypt.Net.BCrypt.HashPassword(adminPassword, workFactor: 11);
            await SetAdminPassword(adminHash);

            if (imported)
                await VerifyCounts(snapshot);

            return imported;
        }
        finally
        {
            await ReleaseLifecycleLock(lifecycleLock);
        }
    }

    private async Task WaitForSqlServer(TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        Exception? lastError = null;

        while (stopwatch.Elapsed < timeout)
        {
            try
            {
                await using var connection = new SqlConnection(_masterConnection);
                await connection.OpenAsync();
                return;
            }
            catch (SqlException exception)
            {
                lastError = exception;
                var remaining = timeout - stopwatch.Elapsed;
                if (remaining <= TimeSpan.Zero)
                    break;
                await Task.Delay(remaining < TimeSpan.FromSeconds(5) ? remaining : TimeSpan.FromSeconds(5));
            }
        }

        throw new TimeoutException($"SQL Server did not become ready within {timeout}.", lastError);
    }

    private async Task<SqlConnection> AcquireLifecycleLock(TimeSpan timeout)
    {
        var connection = new SqlConnection(_masterConnection);
        try
        {
            await connection.OpenAsync();
            await using var command = new SqlCommand("""
DECLARE @lockResult INT;
EXEC @lockResult = sys.sp_getapplock
    @Resource = @resource,
    @LockMode = N'Exclusive',
    @LockOwner = N'Session',
    @LockTimeout = @lockTimeout;
SELECT @lockResult;
""", connection)
            {
                CommandTimeout = Math.Max(30, checked((int)Math.Ceiling(timeout.TotalSeconds)) + 5)
            };
            command.Parameters.AddWithValue("@resource", _target.LockResource);
            command.Parameters.AddWithValue("@lockTimeout", checked((int)Math.Ceiling(timeout.TotalMilliseconds)));
            var result = Convert.ToInt32(await command.ExecuteScalarAsync());
            if (result < 0)
                throw new TimeoutException($"Could not acquire bootstrap lifecycle lock within {timeout}.");
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private async Task ReleaseLifecycleLock(SqlConnection connection)
    {
        if (connection.State != ConnectionState.Open)
            return;

        await using var command = new SqlCommand("""
DECLARE @releaseResult INT;
EXEC @releaseResult = sys.sp_releaseapplock
    @Resource = @resource,
    @LockOwner = N'Session';
SELECT @releaseResult;
""", connection);
        command.Parameters.AddWithValue("@resource", _target.LockResource);
        var result = Convert.ToInt32(await command.ExecuteScalarAsync());
        if (result < 0)
            throw new InvalidOperationException($"Could not release bootstrap lifecycle lock (result {result}).");
    }

    private async Task EnsureSchemaOnlyWhenDatabaseIsEmpty(SqlConnection master, string schemaPath)
    {
        var databaseExists = await ScalarLong(
            master,
            "SELECT COUNT_BIG(*) FROM sys.databases WHERE name = @databaseName",
            parameters: new[] { new SqlParameter("@databaseName", _target.DatabaseName) }) == 1;
        if (!databaseExists)
            await Execute(master, $"CREATE DATABASE {QuoteIdentifier(_target.DatabaseName)}");

        await using var database = new SqlConnection(_databaseConnection);
        await database.OpenAsync();
        await using var transaction = (SqlTransaction)await database.BeginTransactionAsync(IsolationLevel.Serializable);
        var tableCount = await ScalarLong(database, "SELECT COUNT_BIG(*) FROM sys.tables WHERE is_ms_shipped = 0", transaction);
        if (tableCount > 0)
        {
            await transaction.CommitAsync();
            return;
        }

        var schema = await File.ReadAllTextAsync(schemaPath);
        var batches = BootstrapSql.SafeSchemaBatches(schema);
        if (batches.Count == 0)
            throw new InvalidDataException("Schema contains no safe batches to execute.");

        foreach (var batch in batches)
            await Execute(database, batch, transaction, commandTimeout: 120);

        await transaction.CommitAsync();
    }

    private async Task EnsureApplicationLogin(SqlConnection master, string password)
    {
        var escapedPassword = password.Replace("'", "''", StringComparison.Ordinal);
        var escapedLogin = _target.AppLogin.Replace("'", "''", StringComparison.Ordinal);
        var quotedLogin = QuoteIdentifier(_target.AppLogin);
        await Execute(master, $"""
IF SUSER_ID(N'{escapedLogin}') IS NULL
    CREATE LOGIN {quotedLogin} WITH PASSWORD = N'{escapedPassword}', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
ELSE
BEGIN
    ALTER LOGIN {quotedLogin} WITH PASSWORD = N'{escapedPassword}';
    ALTER LOGIN {quotedLogin} ENABLE;
END
""");

        await using var database = new SqlConnection(_databaseConnection);
        await database.OpenAsync();
        await Execute(database, $"""
IF DATABASE_PRINCIPAL_ID(N'{escapedLogin}') IS NULL
    CREATE USER {quotedLogin} FOR LOGIN {quotedLogin};
ELSE
    ALTER USER {quotedLogin} WITH LOGIN = {quotedLogin};

IF ISNULL(IS_ROLEMEMBER(N'db_datareader', N'{escapedLogin}'), 0) <> 1
    ALTER ROLE [db_datareader] ADD MEMBER {quotedLogin};
IF ISNULL(IS_ROLEMEMBER(N'db_datawriter', N'{escapedLogin}'), 0) <> 1
    ALTER ROLE [db_datawriter] ADD MEMBER {quotedLogin};
""");
    }

    private async Task<bool> ImportSeedOnlyWhenMarkerMissing(SeedSnapshot snapshot, string version)
    {
        await using var database = new SqlConnection(_databaseConnection);
        await database.OpenAsync();
        await using var transaction = (SqlTransaction)await database.BeginTransactionAsync(IsolationLevel.Serializable);

        var markerTableExists = await ScalarLong(
            database,
            $"SELECT COUNT_BIG(*) FROM sys.tables WHERE object_id = OBJECT_ID(N'{MarkerTable}')",
            transaction) == 1;
        var markerExists = markerTableExists && await ScalarLong(
            database,
            $"SELECT COUNT_BIG(*) FROM {MarkerTable} WHERE [version] = @version",
            transaction,
            new SqlParameter("@version", version)) == 1;

        long businessRows = 0;
        var usersState = ExistingUsersState.None;
        if (!markerExists)
        {
            foreach (var table in BootstrapSql.SeedTables)
                businessRows += await ScalarLong(database, $"SELECT COUNT_BIG(*) FROM dbo.[{table.Name}]", transaction);
            usersState = await GetExistingUsersState(database, transaction);
        }

        if (BootstrapSql.DecideSeedImport(markerExists, businessRows, usersState) == SeedImportDecision.Skip)
        {
            await transaction.CommitAsync();
            return false;
        }

        await Execute(database, $"""
IF OBJECT_ID(N'{MarkerTable}', N'U') IS NULL
BEGIN
    CREATE TABLE {MarkerTable} (
        [version] NVARCHAR(32) NOT NULL PRIMARY KEY,
        imported_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
""", transaction);

        foreach (var table in BootstrapSql.SeedTables)
            await InsertTable(database, transaction, snapshot, table);

        await ImportUsers(database, transaction, snapshot.Users);
        await VerifyCounts(database, transaction, snapshot);
        await Execute(
            database,
            $"INSERT INTO {MarkerTable} ([version]) VALUES (@version)",
            transaction,
            parameters: new[] { new SqlParameter("@version", version) });
        await transaction.CommitAsync();
        return true;
    }

    private static async Task<ExistingUsersState> GetExistingUsersState(
        SqlConnection database,
        SqlTransaction transaction)
    {
        var userCount = await ScalarLong(database, "SELECT COUNT_BIG(*) FROM dbo.Users", transaction);
        if (userCount == 0)
            return ExistingUsersState.None;
        if (userCount != 1)
            return ExistingUsersState.ExistingData;

        var placeholderCount = await ScalarLong(
            database,
            """
SELECT COUNT_BIG(*)
FROM dbo.Users
WHERE Id = 1
  AND Username = N'admin'
  AND PasswordHash = @disabledHash
  AND DisplayName = N'管理员'
  AND Userbqrpower = '111111111'
  AND Usereditpower = '111111111'
  AND IsActive = 1
""",
            transaction,
            new SqlParameter("@disabledHash", BootstrapSql.DisabledPasswordHash));
        return placeholderCount == 1
            ? ExistingUsersState.ExpectedPlaceholder
            : ExistingUsersState.ExistingData;
    }

    private async Task SetAdminPassword(string passwordHash)
    {
        await using var database = new SqlConnection(_databaseConnection);
        await database.OpenAsync();
        await Execute(database, """
UPDATE dbo.Users
SET PasswordHash = @passwordHash, IsActive = 1
WHERE Username = N'admin';

IF @@ROWCOUNT = 0
BEGIN
    INSERT INTO dbo.Users (Username, PasswordHash, DisplayName, Userbqrpower, Usereditpower, IsActive)
    VALUES (N'admin', @passwordHash, N'管理员', '111111111', '111111111', 1);
END
""", parameters: new[] { new SqlParameter("@passwordHash", passwordHash) });
    }

    private async Task VerifyCounts(SeedSnapshot snapshot)
    {
        await using var database = new SqlConnection(_databaseConnection);
        await database.OpenAsync();
        await VerifyCounts(database, null, snapshot);
    }

    private static async Task InsertTable(
        SqlConnection database,
        SqlTransaction transaction,
        SeedSnapshot snapshot,
        SeedTable table)
    {
        var rows = table.Name == "images" ? snapshot.Images : snapshot.Rows(table.Name);
        if (rows.Count == 0)
            return;

        if (table.Name == "images")
        {
            await BulkInsertImages(database, transaction, snapshot, table, rows);
            return;
        }

        if (table.HasIdentity)
            await Execute(database, $"SET IDENTITY_INSERT dbo.[{table.Name}] ON", transaction);

        try
        {
            var columnSql = string.Join(", ", table.Columns.Select(column => $"[{column}]"));
            var parameterSql = string.Join(", ", table.Columns.Select((_, index) => $"@p{index}"));
            var insertSql = $"INSERT INTO dbo.[{table.Name}] ({columnSql}) VALUES ({parameterSql})";

            foreach (var row in rows)
            {
                await using var command = new SqlCommand(insertSql, database, transaction);
                for (var index = 0; index < table.Columns.Length; index++)
                {
                    var column = table.Columns[index];
                    var value = SnapshotValue(snapshot, table.Name, row, column);
                    AddParameter(command, $"@p{index}", column, value);
                }
                await command.ExecuteNonQueryAsync();
            }
        }
        finally
        {
            if (table.HasIdentity)
                await Execute(database, $"SET IDENTITY_INSERT dbo.[{table.Name}] OFF", transaction);
        }
    }

    private static async Task BulkInsertImages(
        SqlConnection database,
        SqlTransaction transaction,
        SeedSnapshot snapshot,
        SeedTable table,
        IReadOnlyList<JsonElement> rows)
    {
        var data = new DataTable();
        foreach (var column in table.Columns)
            data.Columns.Add(column, typeof(string));

        foreach (var row in rows)
        {
            var values = table.Columns
                .Select(column => SnapshotValue(snapshot, table.Name, row, column))
                .ToArray();
            data.Rows.Add(values);
        }

        using var bulkCopy = new SqlBulkCopy(database, SqlBulkCopyOptions.CheckConstraints, transaction)
        {
            DestinationTableName = "dbo.images",
            BatchSize = 100,
            BulkCopyTimeout = 120,
            EnableStreaming = true
        };
        foreach (var column in table.Columns)
            bulkCopy.ColumnMappings.Add(column, column);
        await bulkCopy.WriteToServerAsync(data);
    }

    private static object SnapshotValue(SeedSnapshot snapshot, string table, JsonElement row, string column)
    {
        if (table == "images" && column == "created_at")
        {
            var id = row.GetProperty("id").GetString() ?? throw new InvalidDataException("Image payload has no id.");
            if (!snapshot.TryGetImageMetadata(id, out var metadata))
                throw new InvalidDataException($"Image {id} has no metadata row.");
            return JsonValue(metadata.GetProperty("created_at"));
        }

        return row.TryGetProperty(column, out var property) ? JsonValue(property) : DBNull.Value;
    }

    private static object JsonValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => DBNull.Value,
        JsonValueKind.String => value.GetString() ?? (object)DBNull.Value,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number when value.TryGetInt64(out var integer) => integer,
        JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
        JsonValueKind.Number => value.GetDouble(),
        _ => value.GetRawText()
    };

    private static void AddParameter(SqlCommand command, string name, string column, object value)
    {
        if (value is string text && column is "data_url" or "moldings" or "raw_rows" or "diff_from_prev" or "notes" or "value")
        {
            command.Parameters.Add(name, SqlDbType.NVarChar, -1).Value = text;
            return;
        }

        command.Parameters.AddWithValue(name, value);
    }

    private static async Task ImportUsers(
        SqlConnection database,
        SqlTransaction transaction,
        IReadOnlyList<JsonElement> users)
    {
        if (users.Count == 0)
            return;

        await Execute(database, "SET IDENTITY_INSERT dbo.Users ON", transaction);
        try
        {
            const string sql = """
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username = @username AND Id <> @id)
    THROW 51000, 'Snapshot username has a conflicting user ID.', 1;
IF EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @id AND Username <> @username)
    THROW 51000, 'Snapshot user ID has a conflicting username.', 1;

IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username = @username)
BEGIN
    UPDATE dbo.Users
    SET DisplayName = @displayName,
        Userbqrpower = @userbqrpower,
        Usereditpower = @usereditpower,
        IsActive = @isActive,
        CreatedAt = @createdAt
    WHERE Username = @username;
END
ELSE
BEGIN
    INSERT INTO dbo.Users
        (Id, Username, PasswordHash, DisplayName, Userbqrpower, Usereditpower, IsActive, CreatedAt)
    VALUES
        (@id, @username, @disabledHash, @displayName, @userbqrpower, @usereditpower, @isActive, @createdAt);
END
""";

            foreach (var user in users)
            {
                var parameters = new[]
                {
                    new SqlParameter("@id", JsonValue(user.GetProperty("id"))),
                    new SqlParameter("@username", JsonValue(user.GetProperty("username"))),
                    new SqlParameter("@disabledHash", BootstrapSql.DisabledPasswordHash),
                    new SqlParameter("@displayName", JsonValue(user.GetProperty("displayName"))),
                    new SqlParameter("@userbqrpower", JsonValue(user.GetProperty("userbqrpower"))),
                    new SqlParameter("@usereditpower", JsonValue(user.GetProperty("usereditpower"))),
                    new SqlParameter("@isActive", JsonValue(user.GetProperty("isActive"))),
                    new SqlParameter("@createdAt", JsonValue(user.GetProperty("createdAt")))
                };
                await Execute(database, sql, transaction, parameters: parameters);
            }
        }
        finally
        {
            await Execute(database, "SET IDENTITY_INSERT dbo.Users OFF", transaction);
        }
    }

    private static async Task VerifyCounts(SqlConnection database, SqlTransaction? transaction, SeedSnapshot snapshot)
    {
        foreach (var table in BootstrapSql.SeedTables)
        {
            var actual = await ScalarLong(database, $"SELECT COUNT_BIG(*) FROM dbo.[{table.Name}]", transaction);
            var expected = snapshot.Count(table.Name);
            if (actual != expected)
                throw new InvalidDataException($"Seed verification failed for {table.Name}: expected {expected}, got {actual}.");
        }

        var imagePayloads = await ScalarLong(database, "SELECT COUNT_BIG(*) FROM dbo.images WHERE data_url IS NOT NULL", transaction);
        if (imagePayloads != snapshot.Images.Count)
            throw new InvalidDataException($"Image payload verification failed: expected {snapshot.Images.Count}, got {imagePayloads}.");
    }

    private static string WithDatabase(string connectionString, string database)
    {
        var builder = new SqlConnectionStringBuilder(connectionString) { InitialCatalog = database };
        return builder.ConnectionString;
    }

    private static string QuoteIdentifier(string identifier) =>
        $"[{identifier.Replace("]", "]]", StringComparison.Ordinal)}]";

    private static void ValidateTarget(BootstrapTarget target)
    {
        if (string.IsNullOrWhiteSpace(target.DatabaseName) || target.DatabaseName.Length > 128)
            throw new ArgumentException("Bootstrap database name must contain 1-128 characters.", nameof(target));
        if (string.IsNullOrWhiteSpace(target.AppLogin) || target.AppLogin.Length > 128)
            throw new ArgumentException("Bootstrap login name must contain 1-128 characters.", nameof(target));
        if (string.IsNullOrWhiteSpace(target.LockResource) || target.LockResource.Length > 255)
            throw new ArgumentException("Bootstrap lock resource must contain 1-255 characters.", nameof(target));
    }

    private static async Task<long> ScalarLong(
        SqlConnection connection,
        string sql,
        SqlTransaction? transaction = null,
        params SqlParameter[] parameters)
    {
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddRange(parameters);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private static async Task Execute(
        SqlConnection connection,
        string sql,
        SqlTransaction? transaction = null,
        SqlParameter[]? parameters = null,
        int commandTimeout = 30)
    {
        await using var command = new SqlCommand(sql, connection, transaction) { CommandTimeout = commandTimeout };
        if (parameters is { Length: > 0 })
            command.Parameters.AddRange(parameters);
        await command.ExecuteNonQueryAsync();
    }
}
