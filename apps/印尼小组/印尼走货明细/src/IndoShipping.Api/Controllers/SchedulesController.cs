using System.Text.Json;
using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/schedules")]
public class SchedulesController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet("blob")]
    public async Task<IActionResult> GetBlob()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM dbo.settings WHERE [key]='schedules'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("[]", "application/json"); }
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = (await c.QueryAsync<(int id, string? week_label, DateTime? upload_date, string? raw_rows)>(
            "SELECT id, week_label, upload_date, raw_rows FROM dbo.schedules ORDER BY upload_date DESC")).ToList();
        var output = rows.Select(r => new
        {
            id = r.id,
            week_label = r.week_label,
            upload_date = r.upload_date,
            row_count = CountJson(r.raw_rows),
        });
        return Ok(output);
    }

    // 手动标记"已下单"的键集合（key = "orderNo|code"），与自动匹配合并使用。
    [HttpGet("placed-manual")]
    public async Task<IActionResult> GetPlacedManual()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM dbo.settings WHERE [key]='schedule_placed_manual'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("[]", "application/json"); }
    }

    [HttpPut("placed-manual")]
    public async Task<IActionResult> PutPlacedManual([FromBody] JsonElement body)
    {
        // body: 字符串数组 ["orderNo|code", ...]；去重后整体覆盖保存。
        var keys = body.ValueKind == JsonValueKind.Array
            ? body.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String)
                  .Select(e => e.GetString() ?? "").Where(s => s.Length > 0).Distinct().ToArray()
            : Array.Empty<string>();
        var json = JsonSerializer.Serialize(keys);
        using var c = factory.Create();
        await c.ExecuteAsync(@"
MERGE dbo.settings AS t USING (SELECT 'schedule_placed_manual' AS [key]) s ON t.[key]=s.[key]
WHEN MATCHED THEN UPDATE SET value=@v
WHEN NOT MATCHED THEN INSERT ([key], value) VALUES ('schedule_placed_manual', @v);",
            new { v = json });
        return Ok(new { ok = true, count = keys.Length });
    }

    // 生产下单状态的手动覆盖（key = "orderNo|code", value = true/false）。
    // 未设置的行默认跟随采购状态；已有真实生产单的行由前端始终判定为已下。
    [HttpGet("production-placed-manual")]
    public async Task<IActionResult> GetProductionPlacedManual()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM dbo.settings WHERE [key]='schedule_production_placed_manual'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("{}", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("{}", "application/json"); }
    }

    [HttpPut("production-placed-manual")]
    public async Task<IActionResult> PutProductionPlacedManual([FromBody] JsonElement body)
    {
        var values = new Dictionary<string, bool>();
        if (body.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in body.EnumerateObject())
                if (p.Name.Length > 0 && (p.Value.ValueKind == JsonValueKind.True || p.Value.ValueKind == JsonValueKind.False))
                    values[p.Name] = p.Value.GetBoolean();
        }
        var json = JsonSerializer.Serialize(values);
        using var c = factory.Create();
        await c.ExecuteAsync(@"
MERGE dbo.settings AS t USING (SELECT 'schedule_production_placed_manual' AS [key]) s ON t.[key]=s.[key]
WHEN MATCHED THEN UPDATE SET value=@v
WHEN NOT MATCHED THEN INSERT ([key], value) VALUES ('schedule_production_placed_manual', @v);",
            new { v = json });
        return Ok(new { ok = true, count = values.Count });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        using var c = factory.Create();
        var row = await c.QueryFirstOrDefaultAsync("SELECT * FROM dbo.schedules WHERE id=@id", new { id });
        if (row == null) return NotFound(new { error = "not found" });
        return Ok(row);
    }

    public class CreateBody
    {
        public string? week_label { get; set; }
        public DateTime? upload_date { get; set; }
        public JsonElement? raw_rows { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateBody body)
    {
        using var c = factory.Create();
        // Diff baseline: 按周次标签排序紧邻的"前一周"（week_label 严格小于本次的最大者），
        // 而非按上传时间——这样补传历史周次也不会比错对象。
        var prevRaw = await c.ExecuteScalarAsync<string?>(@"
            SELECT TOP 1 raw_rows FROM dbo.schedules
            WHERE week_label IS NOT NULL AND week_label < @wl
            ORDER BY week_label DESC", new { wl = body.week_label });
        var rawRowsStr = body.raw_rows?.GetRawText() ?? "[]";
        var prevRows = ParseArray(prevRaw);
        var currRows = ParseArray(rawRowsStr);
        var diff = ComputeDiff(prevRows, currRows);
        var diffStr = JsonSerializer.Serialize(diff);
        // Upsert by week_label (overwrite on re-upload of same week)
        var id = await c.ExecuteScalarAsync<int>(@"
MERGE dbo.schedules AS t
USING (SELECT @wl AS week_label) s ON t.week_label = s.week_label
WHEN MATCHED THEN UPDATE SET upload_date=@ud, raw_rows=@rr, diff_from_prev=@df
WHEN NOT MATCHED THEN INSERT (week_label, upload_date, raw_rows, diff_from_prev)
    VALUES (@wl, @ud, @rr, @df)
OUTPUT INSERTED.id;",
            new { wl = body.week_label, ud = body.upload_date, rr = rawRowsStr, df = diffStr });
        return Ok(new { ok = true, id, diff });
    }

    private static int CountJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return 0;
        try { using var d = JsonDocument.Parse(raw); return d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.GetArrayLength() : 0; }
        catch { return 0; }
    }

    private static List<JsonElement> ParseArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new();
        try
        {
            using var d = JsonDocument.Parse(raw);
            if (d.RootElement.ValueKind != JsonValueKind.Array) return new();
            return d.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
        }
        catch { return new(); }
    }

    private static object ComputeDiff(List<JsonElement> prev, List<JsonElement> curr)
    {
        string KeyOf(JsonElement r)
        {
            string Get(string k) => r.ValueKind == JsonValueKind.Object && r.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null
                ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString())
                : "";
            // 以 orderNo(TOMY PO) 为基准：每条 PO 行单独跨周配对，避免同货号多行被折叠
            // key = 客户|货号|orderNo（与前端 keyOf 一致）
            return (Get("customer")) + "|" + (Get("code") != "" ? Get("code") : Get("itemNo")) + "|" + Get("orderNo");
        }
        string Field(JsonElement r, string k) => r.ValueKind == JsonValueKind.Object && r.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null
            ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString())
            : "";
        double Num(JsonElement r, string k) => double.TryParse(Field(r, k), out var d) ? d : 0;
        // 与旧系统一致：仅当 数量 / 走货期(eta) / 品名 / 单价 变化才算"改动"，
        // 箱数、验货期、CUST PO、接单期、国家等变动不标黄。
        bool IsModified(JsonElement p, JsonElement r)
        {
            if (Math.Abs(Num(p, "qty") - Num(r, "qty")) > 1e-9) return true;
            if (Field(p, "eta") != Field(r, "eta")) return true;
            if (Field(p, "productName") != Field(r, "productName")) return true;
            if (Math.Abs(Num(p, "unitPrice") - Num(r, "unitPrice")) > 1e-9) return true;
            return false;
        }
        var prevMap = prev.GroupBy(KeyOf).ToDictionary(g => g.Key, g => g.Last());
        var currMap = curr.GroupBy(KeyOf).ToDictionary(g => g.Key, g => g.Last());
        var added   = new List<JsonElement>();
        var removed = new List<JsonElement>();
        var changed = new List<object>();
        foreach (var (k, r) in currMap)
        {
            if (!prevMap.TryGetValue(k, out var p)) added.Add(r);
            else if (IsModified(p, r)) changed.Add(new { from = p, to = r });
        }
        foreach (var (k, r) in prevMap) if (!currMap.ContainsKey(k)) removed.Add(r);
        return new { added, removed, changed };
    }
}
