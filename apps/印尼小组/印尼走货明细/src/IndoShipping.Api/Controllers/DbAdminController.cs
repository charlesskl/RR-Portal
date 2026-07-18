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
    private static string Q(string ident) => "[" + ident.Replace("]", "]]") + "]";

    [HttpGet]
    public async Task<IActionResult> ListTables()
    {
        using var conn = factory.Create();
        var rows = new List<object>();
        foreach (var t in Tables)
        {
            var cnt = await conn.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM dbo.{Q(t)}");
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

        var cols = table.Equals("images", StringComparison.OrdinalIgnoreCase)
            ? "id, mime, created_at, DATALENGTH(data_url) AS size_bytes"
            : "*";

        var sql = $"SELECT {cols} FROM dbo.{Q(table)} ORDER BY (SELECT NULL) OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY";
        var rows = (await conn.QueryAsync(sql, new { offset, limit })).ToList();

        var pk = await PkColumnsAsync(conn, table);
        var columnsSql = @"
SELECT c.name AS Name, t.name AS [Type],
       CAST(CASE WHEN EXISTS (
            SELECT 1 FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
            WHERE i.is_primary_key=1 AND i.object_id=c.object_id AND ic.column_id=c.column_id
       ) THEN 1 ELSE 0 END AS BIT) AS Pk,
       CAST(CASE WHEN c.is_nullable=0 THEN 1 ELSE 0 END AS BIT) AS Nn
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(@t)
ORDER BY c.column_id";
        var columns = (await conn.QueryAsync<ColumnInfo>(columnsSql, new { t = $"dbo.{table}" })).ToList();

        return Ok(new { rows, columns, total = rows.Count });
    }

    private static async Task<string> PkColumnAsync(IDbConnection conn, string table)
    {
        var sql = @"
SELECT TOP 1 c.name
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=i.object_id AND c.column_id=ic.column_id
WHERE i.is_primary_key=1 AND i.object_id=OBJECT_ID(@t)
ORDER BY ic.key_ordinal";
        var pk = await conn.ExecuteScalarAsync<string?>(sql, new { t = $"dbo.{table}" });
        return pk ?? "id";
    }

    private static Task<string> PkColumnsAsync(IDbConnection conn, string table) => PkColumnAsync(conn, table);

    [HttpPost("{table}")]
    public async Task<IActionResult> Insert(string table, [FromBody] Dictionary<string, object?> body)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        if (body == null || body.Count == 0) return BadRequest(new { error = "empty body" });
        using var conn = factory.Create();

        var validCols = await ValidColumnsAsync(conn, table);
        var cols = body.Keys.Where(k => validCols.Contains(k)).ToList();
        if (cols.Count == 0) return BadRequest(new { error = "no valid columns" });

        var sql = $"INSERT INTO dbo.{Q(table)} ({string.Join(",", cols.Select(Q))}) VALUES ({string.Join(",", cols.Select(c => "@" + c))}); SELECT CAST(SCOPE_IDENTITY() AS BIGINT);";
        var dyn = new DynamicParameters();
        foreach (var c in cols) dyn.Add(c, body[c]);
        var id = await conn.ExecuteScalarAsync<long?>(sql, dyn);
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
        var sql = $"UPDATE dbo.{Q(table)} SET {sets} WHERE {Q(pk)}=@__id";
        var dyn = new DynamicParameters();
        foreach (var c in cols) dyn.Add(c, body[c]);
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
        await conn.ExecuteAsync($"DELETE FROM dbo.{Q(table)} WHERE {Q(pk)}=@id", new { id });
        return Ok(new { ok = true });
    }

    [HttpDelete("{table}")]
    public async Task<IActionResult> Truncate(string table, [FromQuery] string? confirm)
    {
        if (!Allowed(table)) return BadRequest(new { error = "table not allowed" });
        if (confirm != "YES") return BadRequest(new { error = "add ?confirm=YES to wipe" });
        using var conn = factory.Create();
        await conn.ExecuteAsync($"DELETE FROM dbo.{Q(table)}");
        return Ok(new { ok = true });
    }

    private static async Task<HashSet<string>> ValidColumnsAsync(IDbConnection conn, string table)
    {
        var names = await conn.QueryAsync<string>(
            "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@t)",
            new { t = $"dbo.{table}" });
        return new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
    }
}
