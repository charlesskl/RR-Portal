using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using IndoShipping.Domain.Entities;
using IndoShipping.Infrastructure.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace IndoShipping.Api.Features.Bootstrap;

/// <summary>
/// 生产种子导入：仅在空库且没有 seed marker 时导入业务快照，幂等。
/// 列清单从 information_schema 动态读取（适配 EF 建出的实际 schema），
/// 显式插入自增 id 后用 setval 重置序列。文件不存在则跳过不报错。
/// </summary>
public static class ProductionSeeder
{
    public const string DisabledPasswordHash = "$2a$11$m559Cb68j1R4cHfTHJ5tV.z3oeYQyjPGL/mIlkhdltC70AnKNsLyi";

    private const long AdvisoryLockKey = 20260715L;
    private static readonly TimeSpan LockTimeout = TimeSpan.FromMinutes(2);

    // 导入顺序满足外键：products→materials、purchase_orders→po_items、shipments→shipment_items。
    private static readonly string[] SeedTableOrder =
    {
        "customers", "products", "images", "materials",
        "dict_hs", "dict_supplier", "schedules",
        "purchase_orders", "po_items", "outbound",
        "shipments", "shipment_items", "settings"
    };

    private enum ExistingUsersState
    {
        None,
        ExpectedPlaceholder,
        ExistingData
    }

    private sealed record TableColumn(string Name, string DataType);

    public static async Task SeedAsync(
        AppDbContext db,
        IConfiguration configuration,
        IPasswordHasher passwordHasher,
        ILogger logger)
    {
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync();

        await AcquireAdvisoryLockAsync(connection);
        try
        {
            await ImportSeedSnapshotAsync(connection, configuration, logger);
            await EnsureAdminUserAsync(db, configuration, passwordHasher, logger);
        }
        finally
        {
            await ReleaseAdvisoryLockAsync(connection);
        }
    }

    private static async Task ImportSeedSnapshotAsync(
        NpgsqlConnection connection,
        IConfiguration configuration,
        ILogger logger)
    {
        var seedPath = configuration["SEED_FILE"];
        if (string.IsNullOrWhiteSpace(seedPath))
            seedPath = "/app/seed/business-data.json";

        if (!File.Exists(seedPath))
        {
            logger.LogInformation("Seed file {SeedPath} not found; snapshot import skipped.", seedPath);
            return;
        }

        var snapshot = SeedSnapshot.Load(seedPath);

        await EnsureMarkerTableAsync(connection);
        if (await MarkerExistsAsync(connection, snapshot.SchemaVersion))
        {
            logger.LogInformation("Seed snapshot {Version} was already imported; seed skipped.", snapshot.SchemaVersion);
            return;
        }

        var tableColumns = new Dictionary<string, IReadOnlyList<TableColumn>>(StringComparer.OrdinalIgnoreCase);
        long businessRows = 0;
        foreach (var table in SeedTableOrder)
        {
            var columns = await LoadColumnsAsync(connection, table);
            if (columns.Count == 0)
            {
                if (snapshot.Count(table) > 0)
                    logger.LogWarning(
                        "Seed table {Table} does not exist in the database; {RowCount} snapshot rows skipped.",
                        table, snapshot.Count(table));
                continue;
            }

            tableColumns[table] = columns;
            businessRows += await CountRowsAsync(connection, table);
        }

        var usersState = await GetExistingUsersStateAsync(connection);
        if (businessRows > 0)
            throw new InvalidOperationException("Business tables contain rows without seed marker; refusing to reseed.");
        if (usersState == ExistingUsersState.ExistingData)
            throw new InvalidOperationException("\"Users\" contains existing users without seed marker; refusing to reseed.");

        await using var transaction = (NpgsqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable);

        foreach (var table in SeedTableOrder)
        {
            if (!tableColumns.TryGetValue(table, out var columns))
                continue;
            var rows = table == "images" ? snapshot.Images : snapshot.Rows(table);
            if (rows.Count == 0)
                continue;

            await InsertTableAsync(connection, transaction, snapshot, table, columns, rows);
            await ResetSequenceAsync(connection, transaction, table, $"\"{table}\"", "id", "\"id\"");
        }

        await ImportUsersAsync(connection, transaction, snapshot.Users);
        await VerifyCountsAsync(connection, transaction, snapshot, tableColumns.Keys);
        await InsertMarkerAsync(connection, transaction, snapshot.SchemaVersion);
        await transaction.CommitAsync();
        logger.LogInformation("Seed snapshot {Version} imported from {SeedPath}.", snapshot.SchemaVersion, seedPath);
    }

    private static async Task EnsureAdminUserAsync(
        AppDbContext db,
        IConfiguration configuration,
        IPasswordHasher passwordHasher,
        ILogger logger)
    {
        var initialPassword = configuration["Bootstrap:InitialAdminPassword"];

        if (!await db.Users.AnyAsync())
        {
            if (string.IsNullOrWhiteSpace(initialPassword) || initialPassword.Length < 12)
                throw new InvalidOperationException(
                    "Bootstrap:InitialAdminPassword must contain at least 12 characters when the Users table is empty.");

            db.Users.Add(new User
            {
                Username = "admin",
                PasswordHash = passwordHasher.Hash(initialPassword),
                DisplayName = "管理员",
                Userbqrpower = "111111111",
                Usereditpower = "111111111",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            logger.LogInformation("Seeded initial admin user.");
            return;
        }

        // 快照导入的 admin 带禁用哈希；用环境密码替换一次（幂等，不碰已改密的账号）。
        var placeholder = await db.Users.FirstOrDefaultAsync(
            user => user.Username == "admin" && user.PasswordHash == DisabledPasswordHash);
        if (placeholder is not null
            && !string.IsNullOrWhiteSpace(initialPassword)
            && initialPassword.Length >= 12)
        {
            placeholder.PasswordHash = passwordHasher.Hash(initialPassword);
            await db.SaveChangesAsync();
            logger.LogInformation("Replaced disabled admin password hash from Bootstrap:InitialAdminPassword.");
        }
    }

    private static async Task InsertTableAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        SeedSnapshot snapshot,
        string table,
        IReadOnlyList<TableColumn> columns,
        IReadOnlyList<JsonElement> rows)
    {
        var columnSql = string.Join(", ", columns.Select(column => $"\"{column.Name}\""));
        var parameterSql = string.Join(", ", columns.Select((_, index) => $"@p{index}"));
        var insertSql = $"INSERT INTO \"{table}\" ({columnSql}) VALUES ({parameterSql})";

        foreach (var row in rows)
        {
            await using var command = new NpgsqlCommand(insertSql, connection, transaction);
            for (var index = 0; index < columns.Count; index++)
            {
                var value = SnapshotValue(snapshot, table, row, columns[index].Name);
                command.Parameters.AddWithValue($"p{index}", ToParameterValue(value, columns[index].DataType));
            }
            await command.ExecuteNonQueryAsync();
        }
    }

    private static async Task ImportUsersAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyList<JsonElement> users)
    {
        if (users.Count == 0)
            return;

        foreach (var user in users)
        {
            var id = user.GetProperty("id").GetInt32();
            var username = user.GetProperty("username").GetString()
                           ?? throw new InvalidDataException("Snapshot user has no username.");

            var idByUsername = await ScalarAsync(
                connection, transaction,
                "SELECT \"Id\" FROM \"Users\" WHERE \"Username\" = @username",
                new NpgsqlParameter("username", username));
            if (idByUsername is not null && Convert.ToInt32(idByUsername) != id)
                throw new InvalidDataException("Snapshot username has a conflicting user ID.");

            var usernameById = await ScalarAsync(
                connection, transaction,
                "SELECT \"Username\" FROM \"Users\" WHERE \"Id\" = @id",
                new NpgsqlParameter("id", id));
            if (usernameById is not null && !string.Equals((string)usernameById, username, StringComparison.Ordinal))
                throw new InvalidDataException("Snapshot user ID has a conflicting username.");

            await using var command = new NpgsqlCommand("""
                INSERT INTO "Users" ("Id", "Username", "PasswordHash", "DisplayName", "Userbqrpower", "Usereditpower", "IsActive", "CreatedAt")
                VALUES (@id, @username, @hash, @displayName, @bqr, @edit, @active, @created)
                ON CONFLICT ("Username") DO UPDATE SET
                    "DisplayName" = EXCLUDED."DisplayName",
                    "Userbqrpower" = EXCLUDED."Userbqrpower",
                    "Usereditpower" = EXCLUDED."Usereditpower",
                    "IsActive" = EXCLUDED."IsActive",
                    "CreatedAt" = EXCLUDED."CreatedAt"
                """, connection, transaction);
            command.Parameters.AddWithValue("id", id);
            command.Parameters.AddWithValue("username", username);
            command.Parameters.AddWithValue("hash", DisabledPasswordHash);
            command.Parameters.AddWithValue("displayName", StringOrDbNull(user, "displayName"));
            command.Parameters.AddWithValue("bqr", StringOrDbNull(user, "userbqrpower"));
            command.Parameters.AddWithValue("edit", StringOrDbNull(user, "usereditpower"));
            command.Parameters.AddWithValue("active", BooleanOrDefault(user, "isActive"));
            command.Parameters.AddWithValue("created", TimestampOrDefault(user, "createdAt"));
            await command.ExecuteNonQueryAsync();
        }

        await ResetSequenceAsync(connection, transaction, "\"Users\"", "\"Users\"", "Id", "\"Id\"");
    }

    private static async Task VerifyCountsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        SeedSnapshot snapshot,
        IEnumerable<string> existingTables)
    {
        var tables = existingTables.ToArray();
        foreach (var table in tables)
        {
            var actual = await CountRowsAsync(connection, table, transaction);
            var expected = snapshot.Count(table);
            if (actual != expected)
                throw new InvalidDataException($"Seed verification failed for {table}: expected {expected}, got {actual}.");
        }

        if (tables.Contains("images", StringComparer.OrdinalIgnoreCase))
        {
            var payloads = await ScalarLongAsync(
                connection, transaction,
                "SELECT COUNT(*) FROM \"images\" WHERE \"data_url\" IS NOT NULL");
            if (payloads != snapshot.Images.Count)
                throw new InvalidDataException(
                    $"Image payload verification failed: expected {snapshot.Images.Count}, got {payloads}.");
        }
    }

    private static async Task ResetSequenceAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string sequenceLookupName,
        string quotedTable,
        string columnName,
        string quotedColumn)
    {
        var sequence = await ScalarAsync(
            connection, transaction,
            $"SELECT pg_get_serial_sequence('{sequenceLookupName}', '{columnName}')");
        if (sequence is null || sequence is DBNull)
            return;

        await using var command = new NpgsqlCommand(
            $"SELECT setval('{sequence}', COALESCE((SELECT MAX({quotedColumn}) FROM {quotedTable}), 1))",
            connection, transaction);
        await command.ExecuteScalarAsync();
    }

    private static async Task<IReadOnlyList<TableColumn>> LoadColumnsAsync(NpgsqlConnection connection, string table)
    {
        await using var command = new NpgsqlCommand("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = @table
            ORDER BY ordinal_position
            """, connection);
        command.Parameters.AddWithValue("table", table);

        var columns = new List<TableColumn>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            columns.Add(new TableColumn(reader.GetString(0), reader.GetString(1)));
        return columns;
    }

    private static async Task<ExistingUsersState> GetExistingUsersStateAsync(NpgsqlConnection connection)
    {
        var userCount = await ScalarLongAsync(connection, null, "SELECT COUNT(*) FROM \"Users\"");
        if (userCount == 0)
            return ExistingUsersState.None;
        if (userCount != 1)
            return ExistingUsersState.ExistingData;

        var placeholderCount = await ScalarLongAsync(
            connection, null,
            """
            SELECT COUNT(*)
            FROM "Users"
            WHERE "Id" = 1
              AND "Username" = 'admin'
              AND "PasswordHash" = @disabledHash
              AND "DisplayName" = '管理员'
              AND "Userbqrpower" = '111111111'
              AND "Usereditpower" = '111111111'
              AND "IsActive" = true
            """,
            new NpgsqlParameter("disabledHash", DisabledPasswordHash));
        return placeholderCount == 1
            ? ExistingUsersState.ExpectedPlaceholder
            : ExistingUsersState.ExistingData;
    }

    private static async Task EnsureMarkerTableAsync(NpgsqlConnection connection)
    {
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS "__rr_seed_history" (
                version text NOT NULL PRIMARY KEY,
                imported_at timestamp without time zone NOT NULL DEFAULT now()
            )
            """, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> MarkerExistsAsync(NpgsqlConnection connection, string version)
    {
        var result = await ScalarAsync(
            connection, null,
            "SELECT EXISTS (SELECT 1 FROM \"__rr_seed_history\" WHERE version = @version)",
            new NpgsqlParameter("version", version));
        return result is true;
    }

    private static async Task InsertMarkerAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string version)
    {
        await using var command = new NpgsqlCommand(
            "INSERT INTO \"__rr_seed_history\" (version) VALUES (@version)", connection, transaction);
        command.Parameters.AddWithValue("version", version);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task AcquireAdvisoryLockAsync(NpgsqlConnection connection)
    {
        var stopwatch = Stopwatch.StartNew();
        while (true)
        {
            await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock(@key)", connection);
            command.Parameters.AddWithValue("key", AdvisoryLockKey);
            if (await command.ExecuteScalarAsync() is true)
                return;
            if (stopwatch.Elapsed > LockTimeout)
                throw new TimeoutException($"Could not acquire seed advisory lock within {LockTimeout}.");
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
    }

    private static async Task ReleaseAdvisoryLockAsync(NpgsqlConnection connection)
    {
        if (connection.State != ConnectionState.Open)
            return;
        await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(@key)", connection);
        command.Parameters.AddWithValue("key", AdvisoryLockKey);
        await command.ExecuteScalarAsync();
    }

    private static JsonElement? SnapshotValue(SeedSnapshot snapshot, string table, JsonElement row, string column)
    {
        if (table == "images" && column == "created_at" && !row.TryGetProperty(column, out _))
        {
            var id = row.GetProperty("id").GetString() ?? throw new InvalidDataException("Image payload has no id.");
            if (!snapshot.TryGetImageMetadata(id, out var metadata))
                throw new InvalidDataException($"Image {id} has no metadata row.");
            return metadata.GetProperty("created_at");
        }

        return row.TryGetProperty(column, out var property) ? property : null;
    }

    private static object ToParameterValue(JsonElement? value, string dataType)
    {
        if (value is not { } element || element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return DBNull.Value;

        switch (dataType)
        {
            case "integer":
                return element.ValueKind == JsonValueKind.Number
                    ? element.GetInt32()
                    : int.Parse(element.GetString()!, CultureInfo.InvariantCulture);
            case "bigint":
                return element.ValueKind == JsonValueKind.Number
                    ? element.GetInt64()
                    : long.Parse(element.GetString()!, CultureInfo.InvariantCulture);
            case "smallint":
                return element.ValueKind == JsonValueKind.Number
                    ? element.GetInt16()
                    : short.Parse(element.GetString()!, CultureInfo.InvariantCulture);
            case "numeric":
                return element.ValueKind == JsonValueKind.Number
                    ? element.GetDecimal()
                    : decimal.Parse(element.GetString()!, CultureInfo.InvariantCulture);
            case "real":
            case "double precision":
                return element.ValueKind == JsonValueKind.Number
                    ? element.GetDouble()
                    : double.Parse(element.GetString()!, CultureInfo.InvariantCulture);
            case "boolean":
                return element.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Number => element.GetInt32() != 0,
                    _ => element.GetString() is "1" or "true" or "TRUE" or "True"
                };
            case "date":
            case "timestamp without time zone":
            case "timestamp with time zone":
                return ParseTimestamp(element);
            default:
                return element.ValueKind == JsonValueKind.String
                    ? element.GetString()!
                    : element.GetRawText();
        }
    }

    private static DateTime ParseTimestamp(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
            throw new InvalidDataException($"Expected ISO date string, got {element.ValueKind}.");
        var parsed = DateTime.Parse(element.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        return DateTime.SpecifyKind(parsed, DateTimeKind.Unspecified);
    }

    private static object StringOrDbNull(JsonElement row, string property) =>
        row.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()!
            : DBNull.Value;

    private static bool BooleanOrDefault(JsonElement row, string property) =>
        row.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;

    private static DateTime TimestampOrDefault(JsonElement row, string property) =>
        row.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? ParseTimestamp(value)
            : DateTime.UtcNow;

    private static async Task<long> CountRowsAsync(
        NpgsqlConnection connection,
        string table,
        NpgsqlTransaction? transaction = null) =>
        await ScalarLongAsync(connection, transaction, $"SELECT COUNT(*) FROM \"{table}\"");

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string sql,
        params NpgsqlParameter[] parameters) =>
        Convert.ToInt64(await ScalarAsync(connection, transaction, sql, parameters));

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string sql,
        params NpgsqlParameter[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddRange(parameters);
        return await command.ExecuteScalarAsync();
    }
}
