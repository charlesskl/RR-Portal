using System.Data;
using Dapper;
using IndoShipping.Api.Auth;
using IndoShipping.Domain.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/db")]
[RequirePermission(PermissionPosition.Customers)]
public class DbAdminController(ISqlConnectionFactory factory) : ControllerBase
{
    private static readonly HashSet<string> Tables = new(StringComparer.OrdinalIgnoreCase)
    {
        "customers", "products", "materials", "images",
        "dict_hs", "dict_supplier",
        "schedules", "purchase_orders", "po_items",
        "outbound", "shipments", "shipment_items", "settings"
    };

    private static bool Allowed(string t) => Tables.Contains(t);
    private static string Q(string ident) => "\"" + ident.Replace("\"", "\"\"") + "\"";

    [HttpGet]
    public async Task<IActionResult> ListTables()
    {
        using var conn = factory.Create();
        var rows = new List<object>();
        foreach (var t in Tables)
        {
            var cnt = await conn.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM {Q(t)}");
            rows.Add(new { table = t, count = cnt });
        }
        return Ok(rows);
    }

    public record ColumnInfo(string name, string type, bool pk, bool nn);

    [HttpGet("{table}")]
    public async Task<IActionResult> GetRows(string table, [FromQuery] int limit = 1000, [FromQuery] int offset = 0)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        limit = Math.Clamp(limit, 1, 5000);
        offset = Math.Max(0, offset);
        using var conn = factory.Create();

        var pk = await PkColumnAsync(conn, table);
        var cols = table.Equals("images", StringComparison.OrdinalIgnoreCase)
            ? "id, mime, created_at, octet_length(data_url) AS size_bytes"
            : "*";

        var sql = $"SELECT {cols} FROM {Q(table)} ORDER BY {Q(pk)} OFFSET @offset LIMIT @limit";
        var rows = (await conn.QueryAsync(sql, new { offset, limit })).ToList();

        var columnsSql = @"
SELECT c.column_name AS ""name"", c.data_type AS ""type"",
       EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint con
            JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
            JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
            WHERE con.contype = 'p'
              AND rel.relname = c.table_name
              AND a.attname = c.column_name
       ) AS ""pk"",
       (c.is_nullable = 'NO') AS ""nn""
FROM information_schema.columns c
WHERE c.table_schema = current_schema() AND c.table_name = @tableName
ORDER BY c.ordinal_position";
        var columns = (await conn.QueryAsync<ColumnInfo>(columnsSql, new { tableName = table })).ToList();

        return Ok(new { rows, columns, total = rows.Count });
    }

    private static async Task<string> PkColumnAsync(IDbConnection conn, string table)
    {
        var sql = @"
SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = current_schema()
  AND tc.table_name = @tableName
ORDER BY kcu.ordinal_position
LIMIT 1";
        var pk = await conn.ExecuteScalarAsync<string?>(sql, new { tableName = table });
        return pk ?? "id";
    }

    [HttpPost("{table}")]
    public async Task<IActionResult> Insert(string table, [FromBody] Dictionary<string, object?> body)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        if (body == null || body.Count == 0) return BadRequest(new { error = "empty body" });
        using var conn = factory.Create();

        var pk = await PkColumnAsync(conn, table);
        var validCols = await ValidColumnsAsync(conn, table);
        var cols = body.Keys.Where(k => validCols.Contains(k)).ToList();
        if (cols.Count == 0) return BadRequest(new { error = "no valid columns" });

        var sql = $"INSERT INTO {Q(table)} ({string.Join(",", cols.Select(Q))}) VALUES ({string.Join(",", cols.Select(c => "@" + c))}) RETURNING {Q(pk)}";
        var dyn = new DynamicParameters();
        foreach (var c in cols) dyn.Add(c, ParamValues.Normalize(body[c]));
        var id = await conn.ExecuteScalarAsync(sql, dyn);
        return Ok(new { ok = true, lastID = id });
    }

    [HttpPut("{table}/{id}")]
    public async Task<IActionResult> Update(string table, string id, [FromBody] Dictionary<string, object?> body)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        body ??= new();
        using var conn = factory.Create();
        var pk = await PkColumnAsync(conn, table);
        body.Remove(pk);
        var validCols = await ValidColumnsAsync(conn, table);
        var cols = body.Keys.Where(k => validCols.Contains(k)).ToList();
        if (cols.Count == 0) return Ok(new { ok = true, noop = true });
        var sets = string.Join(",", cols.Select(c => $"{Q(c)}=@{c}"));
        var sql = $"UPDATE {Q(table)} SET {sets} WHERE {Q(pk)}::text = @__id";
        var dyn = new DynamicParameters();
        foreach (var c in cols) dyn.Add(c, ParamValues.Normalize(body[c]));
        dyn.Add("__id", id);
        await conn.ExecuteAsync(sql, dyn);
        return Ok(new { ok = true });
    }

    [HttpDelete("{table}/{id}")]
    public async Task<IActionResult> DeleteRow(string table, string id)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        using var conn = factory.Create();
        var pk = await PkColumnAsync(conn, table);
        await conn.ExecuteAsync($"DELETE FROM {Q(table)} WHERE {Q(pk)}::text = @id", new { id });
        return Ok(new { ok = true });
    }

    [HttpDelete("{table}")]
    public async Task<IActionResult> Truncate(string table, [FromQuery] string? confirm)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        if (confirm != "YES") return BadRequest(new { error = "add ?confirm=YES to wipe" });
        using var conn = factory.Create();
        await conn.ExecuteAsync($"DELETE FROM {Q(table)}");
        return Ok(new { ok = true });
    }

    private static async Task<HashSet<string>> ValidColumnsAsync(IDbConnection conn, string table)
    {
        var names = await conn.QueryAsync<string>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = @tableName",
            new { tableName = table });
        return new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
    }
}
