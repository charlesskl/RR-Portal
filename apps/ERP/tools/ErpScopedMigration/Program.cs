using System.Data;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

try
{
    using var operation = new ScopedMigration(args);
    operation.Run();
    return 0;
}
catch (SqlException error)
{
    // SQL error text can contain business values, server names or credentials.
    Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, error = "sql_error", number = error.Number, line = error.LineNumber }));
    return 1;
}
catch (Exception error)
{
    var frames = error is MigrationRejected ? null : new System.Diagnostics.StackTrace(error, true).GetFrames()
        ?.Take(6).Select(x => new { method = x.GetMethod()?.Name, line = x.GetFileLineNumber() });
    Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, error = error is MigrationRejected ? error.Message : error.GetType().Name, frames }));
    return 1;
}

internal sealed class ScopedMigration : IDisposable
{
    private const string Scope = "P112-P113-cloud-173-174-175";
    private static readonly string[] Files =
    [
        "173_raw_material_procurement_policy.sql",
        "174_raw_material_issue_sources.sql",
        "175_cloud_p113_prerequisites.sql"
    ];
    private static readonly string[] NewTables = ["塑胶原料配方", "塑胶原料配方明细", "塑胶采购原料用量", "原料自动扣料期初", "原料流程岗位绑定"];
    // Includes related ledgers and explicit account/permission preservation.
    private static readonly string[] Tables = new[]
    {
        "塑胶原料资料", "原料采购订单", "原料采购订单明细", "原料出库单", "原料出库明细单",
        "塑胶采购订单", "塑胶采购订单明细", "原料盘点单", "原料盘点明细单",
        "原料入仓单", "原料入仓明细单", "原料退仓单", "原料退仓明细单", "原料退库表", "原料退库明细单",
        "原料生产需求表", "原料生产需求明细单", "sysfileuser", "userbqrpower", "人事档案", "部门信息"
    }.Concat(NewTables).Order(StringComparer.Ordinal).ToArray();
    private static readonly HashSet<string> ExpandedDecimals = new(StringComparer.Ordinal)
    {
        "原料出库单/数量", "原料出库明细单/数量", "原料出库明细单/每包重量",
        "原料盘点明细单/系统数量", "原料盘点明细单/盘点数量", "原料盘点明细单/盈亏数量"
    };
    private readonly string mode, expectedDatabase, expectedServer, directory;
    private readonly MigrationManifest manifest;
    private readonly Dictionary<string, byte[]> scripts = new(StringComparer.Ordinal);
    private readonly SqlConnection connection;
    private SqlTransaction? transaction;

    internal ScopedMigration(string[] args)
    {
        Require(args.Length == 7 && args[0] is "inspect" or "apply", "usage: inspect|apply --expected-database erp|erp_test --expected-server VALUE --migrations-dir DIRECTORY");
        mode = args[0];
        var options = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 1; i < args.Length; i += 2)
            Require(options.TryAdd(args[i], args[i + 1]), "duplicate_argument");
        Require(options.Count == 3 && options.ContainsKey("--expected-database") && options.ContainsKey("--expected-server") && options.ContainsKey("--migrations-dir"), "unknown_or_missing_argument");
        expectedDatabase = options["--expected-database"];
        expectedServer = options["--expected-server"];
        directory = Path.GetFullPath(options["--migrations-dir"]);
        Require(expectedDatabase is "erp" or "erp_test", "database_must_be_explicit_erp_or_erp_test");
        Require(!string.IsNullOrWhiteSpace(expectedServer) && expectedServer.Length <= 128, "expected_server_required");
        Require(Directory.Exists(directory) && new DirectoryInfo(directory).LinkTarget is null, "migration_directory_invalid");
        using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("ErpScopedMigration.migration-manifest.json");
        Require(resource is not null, "embedded_manifest_missing");
        manifest = JsonSerializer.Deserialize<MigrationManifest>(resource!, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new MigrationRejected("invalid_manifest");
        Require(manifest.Scope == Scope && manifest.Migrations.Select(x => x.File).SequenceEqual(Files), "manifest_scope_or_order_differs");
        foreach (var entry in manifest.Migrations)
        {
            Require(Regex.IsMatch(entry.Sha256, "^[0-9a-f]{64}$"), "manifest_hash_invalid");
            var path = Path.Combine(directory, entry.File);
            Require(File.Exists(path) && new FileInfo(path).LinkTarget is null, "migration_file_missing_or_linked");
            var bytes = File.ReadAllBytes(path);
            Require(Sha(bytes) == entry.Sha256, "migration_hash_differs");
            scripts.Add(entry.File, bytes);
        }
        var explicitConnection = Environment.GetEnvironmentVariable("ERP_DB");
        Require(!string.IsNullOrWhiteSpace(explicitConnection), "explicit_ERP_DB_required_no_config_is_loaded");
        var configuration = new SqlConnectionStringBuilder(explicitConnection);
        Require(configuration.InitialCatalog == expectedDatabase && configuration.AttachDBFilename.Length == 0 && !configuration.UserInstance, "connection_database_differs");
        configuration.ApplicationName = "ErpScopedMigration-P113";
        connection = new SqlConnection(configuration.ConnectionString);
    }

    internal void Run()
    {
        connection.Open();
        Require(Scalar<string>("SELECT DB_NAME()") == expectedDatabase, "actual_database_differs");
        Require(string.Equals(Scalar<string>("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))"), expectedServer, StringComparison.OrdinalIgnoreCase), "actual_server_differs");
        Command("""
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 15000;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
""");
        if (mode == "inspect")
        {
            var schema = ReadSchema();
            var counts = ExistingTables(schema).ToDictionary(t => t, t => Scalar<long>("SELECT COUNT_BIG(*) FROM " + T(t)), StringComparer.Ordinal);
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, scope = Scope, mode, database = expectedDatabase, serverMatched = true, schemaSha256 = SchemaHash(schema), counts, migrations = manifest.Migrations, businessWrites = 0, transactionalSnapshot = false }));
            return;
        }

        transaction = connection.BeginTransaction(IsolationLevel.Serializable);
        try
        {
            Require(Scalar<int>("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'ERP:P113:scoped-schema',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000; SELECT @r;") >= 0, "migration_lock_unavailable");
            Require(Scalar<int>("SELECT COUNT(*) FROM sys.triggers WHERE parent_class=0 AND is_disabled=0") == 0, "database_ddl_triggers_require_review");
            Require(Scalar<int>("SELECT COUNT(*) FROM sys.server_triggers WHERE is_disabled=0") == 0, "server_ddl_triggers_require_review");
            var oldSchema = ReadSchema();
            var existing = ExistingTables(oldSchema).ToHashSet(StringComparer.Ordinal);
            Require(Tables.Except(NewTables).All(existing.Contains), "required_existing_table_missing_no_auto_create");
            foreach (var table in Tables.Where(existing.Contains))
                Scalar<long>("SELECT COUNT_BIG(*) FROM " + T(table) + " WITH(TABLOCKX,HOLDLOCK)");
            // Re-read metadata after all fixed-order locks, before taking evidence.
            oldSchema = ReadSchema();
            Require(ExistingTables(oldSchema).ToHashSet(StringComparer.Ordinal).SetEquals(existing), "table_set_changed_during_lock_acquisition");
            var original = Fingerprints(oldSchema);
            Apply();
            ValidateSchema();
            ValidatePreservation(oldSchema, original);
            var firstSchema = ReadSchema();
            var firstHash = SchemaHash(firstSchema);
            Apply();
            ValidateSchema();
            ValidatePreservation(oldSchema, original);
            Require(firstHash == SchemaHash(ReadSchema()), "second_run_not_schema_idempotent");
            VerifyFiles();
            Require(Scalar<int>("SELECT @@TRANCOUNT") == 1 && Scalar<int>("SELECT CONVERT(int,XACT_STATE())") == 1, "transaction_state_differs");
            var evidence = JsonSerializer.Serialize(new
            {
                ok = true, scope = Scope, mode, database = expectedDatabase, serverMatched = true,
                migrations = manifest.Migrations, strictRuns = 2, schemaSha256 = firstHash,
                originalRows = original, originalRowsUnchanged = true, newlyAddedColumnsNull = true,
                newlyCreatedTablesEmpty = true, businessDml = 0, accountBindingsCreated = 0,
                atUtc = DateTimeOffset.UtcNow
            });
            transaction.Commit();
            transaction.Dispose();
            transaction = null;
            Console.WriteLine(evidence);
        }
        catch
        {
            try { if (transaction?.Connection is not null) transaction.Rollback(); }
            catch { /* Preserve the original sanitized failure; disconnect also rolls back. */ }
            throw;
        }
    }

    private void Apply()
    {
        foreach (var file in Files)
            foreach (var batch in Regex.Split(Encoding.UTF8.GetString(scripts[file]), @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
                if (!string.IsNullOrWhiteSpace(batch)) Command(batch);
    }

    private void VerifyFiles()
    {
        foreach (var entry in manifest.Migrations)
        {
            var path = Path.Combine(directory, entry.File);
            Require(new FileInfo(path).LinkTarget is null && Sha(File.ReadAllBytes(path)) == entry.Sha256, "migration_file_changed_during_apply");
        }
    }

    private SchemaSnapshot ReadSchema()
    {
        const string filter = " AND t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(SELECT [value] FROM OPENJSON(@tables)) ";
        var columns = Rows("""
SELECT t.name AS [table],c.name AS [column],c.column_id,y.name AS [type],c.max_length,c.precision,c.scale,
c.is_nullable,c.is_identity,c.is_computed,c.collation_name,dc.definition AS [default_definition],cc.definition AS [computed_definition]
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types y ON y.user_type_id=c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id WHERE t.is_ms_shipped=0
""" + filter + " ORDER BY t.name,c.column_id");
        var indexes = Rows("""
SELECT t.name AS [table],i.name,i.type,i.is_unique,i.is_primary_key,i.is_unique_constraint,i.is_disabled,i.has_filter,i.filter_definition,
c.name AS [column],ic.key_ordinal,ic.index_column_id,ic.is_included_column,ic.is_descending_key
FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id
LEFT JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
LEFT JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE t.is_ms_shipped=0
""" + filter + " ORDER BY t.name,i.name,ic.index_column_id");
        var checks = Rows("""
SELECT t.name AS [table],c.name,c.definition,c.is_disabled,c.is_not_trusted
FROM sys.tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id WHERE t.is_ms_shipped=0
""" + filter + " ORDER BY t.name,c.name");
        var foreignKeys = Rows("""
SELECT t.name AS [table],f.name,pc.name AS [column],SCHEMA_NAME(rt.schema_id) AS [target_schema],rt.name AS [target_table],rc.name AS [target_column],
fc.constraint_column_id,f.delete_referential_action,f.update_referential_action,f.is_disabled,f.is_not_trusted
FROM sys.tables t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id
JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
JOIN sys.columns pc ON pc.object_id=fc.parent_object_id AND pc.column_id=fc.parent_column_id
JOIN sys.tables rt ON rt.object_id=f.referenced_object_id
JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE t.is_ms_shipped=0
""" + filter + " ORDER BY t.name,f.name,fc.constraint_column_id");
        return new(columns, indexes, checks, foreignKeys);
    }

    private SortedDictionary<string, RowProof> Fingerprints(SchemaSnapshot old)
    {
        var proofs = new SortedDictionary<string, RowProof>(StringComparer.Ordinal);
        foreach (var table in ExistingTables(old))
        {
            var columns = old.Columns.Where(x => S(x, "table") == table).ToArray();
            var keys = old.Indexes.Where(x => S(x, "table") == table && B(x, "is_primary_key") && I(x, "key_ordinal") > 0)
                .OrderBy(x => I(x, "key_ordinal")).Select(x => Q(S(x, "column"))).ToArray();
            Require(keys.Length > 0, "fingerprint_requires_existing_primary_key");
            string Projection(Dictionary<string, object?> column)
            {
                var name = Q(S(column, "column"));
                return S(column, "type") switch
                {
                    "decimal" or "numeric" => $"CAST({name} AS decimal({I(column, "precision")},{I(column, "scale")})) AS {name}",
                    "image" => $"CAST({name} AS varbinary(max)) AS {name}",
                    "text" => $"CAST({name} AS varchar(max)) AS {name}",
                    "ntext" or "xml" => $"CAST({name} AS nvarchar(max)) AS {name}",
                    _ => name
                };
            }
            var count = Scalar<long>("SELECT COUNT_BIG(*) FROM " + T(table));
            // Nesting FOR JSON yields one full nvarchar(max) cell, not row chunks.
            var value = Scalar<object?>("SELECT (SELECT " + string.Join(",", columns.Select(Projection)) + " FROM " + T(table) + " ORDER BY " + string.Join(",", keys) + " FOR JSON PATH,INCLUDE_NULL_VALUES)");
            var json = ProofUtilities.FingerprintJson(count, value);
            proofs.Add(table, new(count, Sha(Encoding.UTF8.GetBytes(json))));
        }
        return proofs;
    }

    private void ValidatePreservation(SchemaSnapshot before, SortedDictionary<string, RowProof> original)
    {
        var after = ReadSchema();
        foreach (var old in before.Columns)
        {
            var table = S(old, "table"); var column = S(old, "column");
            var current = after.Columns.Single(x => S(x, "table") == table && S(x, "column") == column);
            var normalized = new Dictionary<string, object?>(current);
            if (ExpandedDecimals.Contains(table + "/" + column))
            {
                Require(S(old, "type") is "decimal" or "numeric" && I(old, "scale") <= 8 && I(old, "precision") - I(old, "scale") <= 20, "old_decimal_schema_requires_review");
                foreach (var key in new[] { "type", "max_length", "precision", "scale" }) normalized[key] = old[key];
            }
            Require(JsonSerializer.Serialize(normalized) == JsonSerializer.Serialize(old), "existing_column_metadata_changed");
            if (S(old, "type") is "decimal" or "numeric")
            {
                var sqlType = $"decimal({I(old, "precision")},{I(old, "scale")})";
                var value = Q(column);
                Require(Scalar<long>($"SELECT COUNT_BIG(*) FROM {T(table)} WHERE {value} IS NOT NULL AND (TRY_CONVERT({sqlType},{value}) IS NULL OR {value}<>TRY_CONVERT({sqlType},{value}))") == 0, "decimal_changed_outside_original_precision");
            }
        }
        foreach (var added in after.Columns.Where(x => !before.Columns.Any(y => S(y, "table") == S(x, "table") && S(y, "column") == S(x, "column"))))
        {
            var table = S(added, "table");
            Require(SchemaContract.Columns.Any(x => x.Table == table && x.Name == S(added, "column")), "unexpected_added_column");
            if (original.ContainsKey(table))
            {
                Require(B(added, "is_nullable") && added["default_definition"] is null, "new_existing_table_column_not_plain_nullable");
                Require(Scalar<long>("SELECT COUNT_BIG(*) FROM " + T(table) + " WHERE " + Q(S(added, "column")) + " IS NOT NULL") == 0, "new_column_was_backfilled");
            }
        }
        foreach (var table in NewTables.Where(t => !original.ContainsKey(t)))
            Require(Scalar<long>("SELECT COUNT_BIG(*) FROM " + T(table)) == 0, "new_table_not_empty");
        PreserveRows(before.Indexes, after.Indexes);
        PreserveRows(before.Checks, after.Checks);
        PreserveRows(before.ForeignKeys, after.ForeignKeys);
        Require(JsonSerializer.Serialize(Fingerprints(before)) == JsonSerializer.Serialize(original), "original_business_rows_changed");
    }

    private static void PreserveRows(List<Dictionary<string, object?>> before, List<Dictionary<string, object?>> after)
    {
        var remaining = after.Select(x => JsonSerializer.Serialize(x)).ToList();
        foreach (var row in before)
            Require(remaining.Remove(JsonSerializer.Serialize(row)), "existing_schema_constraint_or_index_changed");
    }

    private void ValidateSchema()
    {
        var schema = ReadSchema();
        foreach (var expected in SchemaContract.Columns)
        {
            var actual = schema.Columns.SingleOrDefault(x => S(x, "table") == expected.Table && S(x, "column") == expected.Name);
            Require(actual is not null && S(actual, "type") == expected.Type && I(actual, "max_length") == expected.Bytes
                && I(actual, "precision") == expected.Precision && I(actual, "scale") == expected.Scale
                && B(actual, "is_nullable") == expected.Nullable && B(actual, "is_identity") == expected.Identity && !B(actual, "is_computed"), "expected_column_shape_differs:" + expected.Table + "/" + expected.Name);
            if (!ExpandedDecimals.Contains(expected.Table + "/" + expected.Name))
            {
                if (expected.Table == "原料流程岗位绑定" && expected.Name == "更新时间")
                    Require(actual!["default_definition"] is string definition && BooleanSql.Canonical(definition) == BooleanSql.Canonical("SYSDATETIME()"), "role_timestamp_default_differs");
                else Require(actual!["default_definition"] is null, "unexpected_snapshot_column_default");
            }
        }
        Check("原料采购订单", "CK_原料采购订单_采购政策版本", "采购政策版本 IS NULL OR 采购政策版本=1");
        Check("原料采购订单明细", "CK_原料采购订单明细_采购政策快照", "采购政策版本 IS NULL OR (采购政策版本=1 AND 每库存单位KG>0 AND (每包重量 IS NULL OR 每包重量>0))");
        Check("塑胶采购订单", "CK_塑胶采购订单_原料扣减方式", "原料扣减方式 IS NULL OR 原料扣减方式=N'领料出库'");
        Check("塑胶原料配方明细", "CK_塑胶原料配方明细_正比例", "比例>0 AND 每库存单位KG>0");
        Check("塑胶采购原料用量", "CK_塑胶采购原料用量_有效数量", "比例>0 AND 总比例>0 AND 用量KG>=0 AND 库存数量>=0 AND 每库存单位KG>0");
        Check("原料流程岗位绑定", "CK_原料流程岗位绑定_岗位范围", """
DATALENGTH(部门编号)=4 AND DATALENGTH(岗位代码)=LEN(岗位代码)*2 AND
((部门编号=N'06' AND (岗位代码 COLLATE Latin1_General_100_BIN2=N'06-clerk' OR 岗位代码 COLLATE Latin1_General_100_BIN2=N'06-supervisor' OR 岗位代码 COLLATE Latin1_General_100_BIN2=N'06-manager') AND 所属仓库 IS NULL)
 OR (部门编号=N'05' AND 岗位代码 COLLATE Latin1_General_100_BIN2=N'05-manager' AND 所属仓库 IS NULL)
 OR (部门编号=N'05' AND 岗位代码 COLLATE Latin1_General_100_BIN2=N'05-warehouse' AND 所属仓库 IS NOT NULL AND 所属仓库=N'原料仓' AND DATALENGTH(所属仓库)=6))
""");
        Index("原料出库明细单", "IX_原料出库明细单_啤机来源原料", false, false, false, ["来源啤机采购单号", "原料编号"], ["单号", "数量", "单位", "每包重量"], "来源啤机采购单号 IS NOT NULL");
        Index("塑胶采购原料用量", "IX_塑胶采购原料用量_采购", false, false, false, ["采购单号", "原料编号"], ["用量KG", "库存数量"]);
        Index("塑胶采购原料用量", "UQ_塑胶采购原料用量_来源", true, false, true, ["采购明细ID", "原料ID"], []);
        Index("塑胶采购原料用量", "PK_塑胶采购原料用量", true, true, false, ["ID"], []);
        Index("塑胶原料配方", "PK_塑胶原料配方", true, true, false, ["原料ID"], []);
        Index("塑胶原料配方明细", "PK_塑胶原料配方明细", true, true, false, ["配方原料ID", "原料ID"], []);
        Index("原料自动扣料期初", "PK_原料自动扣料期初", true, true, false, ["原料编号"], []);
        Index("原料流程岗位绑定", "PK_原料流程岗位绑定", true, true, false, ["用户ID"], []);
        ForeignKey("塑胶原料配方明细", "FK_塑胶原料配方明细_配方", "配方原料ID", "塑胶原料配方", "原料ID");
        ForeignKey("原料流程岗位绑定", "FK_原料流程岗位绑定_账号", "用户ID", "sysfileuser", "ID");

        void Check(string table, string name, string definition)
        {
            var row = schema.Checks.SingleOrDefault(x => S(x, "table") == table && S(x, "name") == name);
            Require(row is not null && !B(row, "is_disabled") && !B(row, "is_not_trusted")
                && BooleanSql.Canonical(S(row, "definition")) == BooleanSql.Canonical(definition), "check_constraint_differs_or_untrusted:" + name);
        }
        void Index(string table, string name, bool unique, bool primary, bool uniqueConstraint, string[] keys, string[] includes, string? filter = null)
        {
            var rows = schema.Indexes.Where(x => S(x, "table") == table && S(x, "name") == name).ToArray();
            Require(rows.Length == keys.Length + includes.Length && rows.All(x => !B(x, "is_disabled")
                && B(x, "is_unique") == unique && B(x, "is_primary_key") == primary && B(x, "is_unique_constraint") == uniqueConstraint
                && I(x, "type") == (primary ? 1 : 2)
                && !B(x, "is_descending_key") && B(x, "has_filter") == (filter is not null)
                && (filter is null ? x["filter_definition"] is null : BooleanSql.Canonical(S(x, "filter_definition")) == BooleanSql.Canonical(filter))), "index_definition_differs:" + name);
            Require(rows.Where(x => !B(x, "is_included_column")).OrderBy(x => I(x, "key_ordinal")).Select(x => S(x, "column")).SequenceEqual(keys), "index_key_order_differs");
            Require(rows.Where(x => B(x, "is_included_column")).Select(x => S(x, "column")).Order(StringComparer.Ordinal).SequenceEqual(includes.Order(StringComparer.Ordinal)), "index_include_differs");
        }
        void ForeignKey(string table, string name, string column, string target, string targetColumn)
        {
            var rows = schema.ForeignKeys.Where(x => S(x, "table") == table && S(x, "name") == name).ToArray();
            Require(rows.Length == 1 && S(rows[0], "column") == column && S(rows[0], "target_schema") == "dbo" && S(rows[0], "target_table") == target
                && S(rows[0], "target_column") == targetColumn && I(rows[0], "delete_referential_action") == 0 && I(rows[0], "update_referential_action") == 0
                && !B(rows[0], "is_disabled") && !B(rows[0], "is_not_trusted"), "foreign_key_differs_or_untrusted");
        }
    }

    private SqlCommand CreateCommand(string sql)
    {
        var command = new SqlCommand(sql, connection, transaction) { CommandTimeout = 300 };
        if (sql.Contains("@tables", StringComparison.Ordinal))
            command.Parameters.Add("@tables", SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(Tables);
        return command;
    }
    private T Scalar<T>(string sql) { using var command = CreateCommand(sql); return (T)command.ExecuteScalar()!; }
    private void Command(string sql) { using var command = CreateCommand(sql); command.ExecuteNonQuery(); }
    private List<Dictionary<string, object?>> Rows(string sql)
    {
        using var command = CreateCommand(sql); using var reader = command.ExecuteReader();
        var rows = new List<Dictionary<string, object?>>();
        while (reader.Read())
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < reader.FieldCount; i++) row.Add(reader.GetName(i), reader.IsDBNull(i) ? null : reader.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }
    private static string[] ExistingTables(SchemaSnapshot schema) => schema.Columns.Select(x => S(x, "table")).Distinct().Order(StringComparer.Ordinal).ToArray();
    private static string SchemaHash(SchemaSnapshot schema) => Sha(JsonSerializer.SerializeToUtf8Bytes(schema));
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string Q(string name) => "[" + name.Replace("]", "]]") + "]";
    private static string T(string name) => "[dbo]." + Q(name);
    private static string S(Dictionary<string, object?> row, string key) => (string)row[key]!;
    private static int I(Dictionary<string, object?> row, string key) => Convert.ToInt32(row[key]);
    private static bool B(Dictionary<string, object?> row, string key) => (bool)row[key]!;
    private static void Require(bool condition, string error) { if (!condition) throw new MigrationRejected(error); }
    public void Dispose() { transaction?.Dispose(); connection.Dispose(); }
}

internal sealed record MigrationManifest(string Scope, MigrationEntry[] Migrations);
internal sealed record MigrationEntry(string File, string Sha256);
internal sealed record RowProof(long Rows, string Sha256);
internal sealed record SchemaSnapshot(List<Dictionary<string, object?>> Columns, List<Dictionary<string, object?>> Indexes, List<Dictionary<string, object?>> Checks, List<Dictionary<string, object?>> ForeignKeys);
internal sealed class MigrationRejected(string message) : Exception(message);
