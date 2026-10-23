using System.Text.Json;
using Dapper;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Api.Features.Schedules;
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
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE key='schedules'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("[]", "application/json"); }
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = (await c.QueryAsync<(int id, string? week_label, DateTime? upload_date, string? raw_rows, string customer)>(
            "SELECT id, week_label, upload_date, raw_rows, customer FROM schedules ORDER BY upload_date DESC, id DESC")).ToList();
        var output = rows.Select(r => new
        {
            id = r.id,
            customer = r.customer,
            week_label = r.week_label,
            upload_date = r.upload_date,
            row_count = CountJson(r.raw_rows),
        });
        return Ok(output);
    }

    // A new upload for one customer must not hide another customer's current orders.
    [HttpGet("latest")]
    public async Task<IActionResult> Latest()
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.RepeatableRead);
        var history = await LoadHistory(c, tx);
        var latest = history.GroupBy(v => v.Snapshot.Customer, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderBy(v => ScheduleLineHistory.Period(v.Snapshot)).ThenBy(v => v.Snapshot.Id).Last())
            .ToList();
        var result = new {
            raw_rows = JsonSerializer.Serialize(latest.SelectMany(v => v.Rows)),
            schedules = latest.Select(v => new { id = v.Snapshot.Id, customer = v.Snapshot.Customer, week_label = v.Snapshot.Label }).ToList()
        };
        tx.Commit();
        return Ok(result);
    }

    // 新标记按逐条跨期配对的 line ID 保存；兼容旧 orderNo|code 标记仅归属历史明细。
    [HttpGet("placed-manual")]
    public async Task<IActionResult> GetPlacedManual()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE key='schedule_placed_manual'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("[]", "application/json"); }
    }

    [HttpPut("placed-manual")]
    public async Task<IActionResult> PutPlacedManual([FromBody] JsonElement body)
    {
        // body: 字符串数组 ["line:...", ...]（兼容旧键）；去重后整体覆盖保存。
        var keys = body.ValueKind == JsonValueKind.Array
            ? body.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String)
                  .Select(e => e.GetString() ?? "").Where(s => s.Length > 0).Distinct().ToArray()
            : Array.Empty<string>();
        var json = JsonSerializer.Serialize(keys);
        using var c = factory.Create();
        await c.ExecuteAsync(@"
INSERT INTO settings(key, value) VALUES ('schedule_placed_manual', @v)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
            new { v = json });
        return Ok(new { ok = true, count = keys.Length });
    }

    // 生产下单状态的明细级手动覆盖（兼容旧 orderNo|code）。
    // 未设置的行默认跟随采购状态；已有真实生产单的行由前端始终判定为已下。
    [HttpGet("production-placed-manual")]
    public async Task<IActionResult> GetProductionPlacedManual()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE key='schedule_production_placed_manual'");
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
INSERT INTO settings(key, value) VALUES ('schedule_production_placed_manual', @v)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
            new { v = json });
        return Ok(new { ok = true, count = values.Count });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.RepeatableRead);
        var row = await c.QueryFirstOrDefaultAsync("SELECT * FROM schedules WHERE id=@id", new { id }, tx);
        if (row == null) return NotFound(new { error = "not found" });
        // Rebuild old stored diffs too: legacy GroupBy(...).Last() discarded duplicate lines.
        var history = await LoadHistory(c, tx);
        var view = history.Single(x => x.Snapshot.Id == id);
        var result = (IDictionary<string, object>)row;
        result["raw_rows"] = JsonSerializer.Serialize(view.Rows);
        result["diff_from_prev"] = JsonSerializer.Serialize(view.Diff);
        tx.Commit();
        return Ok(result);
    }

    public class CreateBody
    {
        public string? customer { get; set; }
        public string? week_label { get; set; }
        public DateTime? upload_date { get; set; }
        public JsonElement? raw_rows { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateBody body)
    {
        if (string.IsNullOrWhiteSpace(body.week_label) || body.week_label.Trim().Length > 64)
            return BadRequest(new { error = "请填写有效周次标签（最多 64 字）" });
        if (body.raw_rows?.ValueKind != JsonValueKind.Array)
            return BadRequest(new { error = "排期明细必须是数组" });
        var importedRows = ScheduleLineHistory.Parse(body.raw_rows?.GetRawText());
        static string NormalizeCustomer(string? value) {
            var name = (value ?? "").Trim();
            if (name.Equals("TOMY", StringComparison.OrdinalIgnoreCase)) return "TOMY";
            if (name.Equals("Spin Master", StringComparison.OrdinalIgnoreCase) || name.Equals("SPIN", StringComparison.OrdinalIgnoreCase))
                return "Spin Master";
            return name;
        }
        var rowCustomers = importedRows.Select(r => NormalizeCustomer(ScheduleLineHistory.Field(r, "customer")))
            .Where(n => n.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var customer = NormalizeCustomer(body.customer);
        if (customer.Length == 0) customer = rowCustomers.Count == 1 ? rowCustomers[0] : "TOMY";
        if (customer.Length > 256 || rowCustomers.Any(n => !n.Equals(customer, StringComparison.OrdinalIgnoreCase)))
            return BadRequest(new { error = "每次上传只能属于一个客户，请检查所选客户与 Excel 客名是否一致" });
        // Legacy API rows may omit customer. Preserve that identity: adding TOMY to
        // those raw rows would duplicate historical material demand/confirmations.
        // New UI imports already include the selected customer on every row.
        foreach (var row in importedRows)
            if (!string.IsNullOrWhiteSpace(ScheduleLineHistory.Field(row, "customer")))
                row["customer"] = customer;
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        await MaterialTrackingHistory.CaptureAsync(c, tx);
        // Freeze the current read-only identities before a backfill can change history order.
        // Store metadata separately so existing material-completion hashes remain valid.
        var oldSnapshots = await LoadSnapshots(c, tx);
        var oldLedger = await LoadLedger(c, tx);
        var oldHistory = ScheduleLineHistory.Build(oldSnapshots, oldLedger);
        var ledger = ScheduleLineHistory.Freeze(oldHistory, oldLedger);
        var rawRowsStr = JsonSerializer.Serialize(importedRows);
        // Only replace the selected customer's period.
        var id = await c.ExecuteScalarAsync<int>(@"
INSERT INTO schedules(customer, week_label, upload_date, raw_rows, diff_from_prev)
VALUES (@customer, @wl, @ud, CAST(@rr AS jsonb), CAST(@df AS jsonb))
ON CONFLICT (customer, week_label) DO UPDATE SET
    upload_date = EXCLUDED.upload_date,
    raw_rows = EXCLUDED.raw_rows,
    diff_from_prev = EXCLUDED.diff_from_prev
RETURNING id;",
            new { customer, wl = body.week_label.Trim(), ud = body.upload_date, rr = rawRowsStr, df = "{}" }, tx);
        var snapshots = await LoadSnapshots(c, tx);
        var current = snapshots.Single(x => x.Id == id);
        var oldPeriod = oldHistory.FirstOrDefault(x => x.Snapshot.Id == id);
        if (oldPeriod is not null)
            ledger.Snapshots[id] = ScheduleLineHistory.Replacement(current, oldPeriod.Rows);
        var history = ScheduleLineHistory.Build(snapshots, ledger);
        var diff = history.Single(x => x.Snapshot.Id == id).Diff;
        await c.ExecuteAsync("UPDATE schedules SET diff_from_prev=CAST(@df AS jsonb) WHERE id=@id",
            new { id, df = JsonSerializer.Serialize(diff) }, tx);
        await c.ExecuteAsync(@"
INSERT INTO settings(key,value) VALUES ('schedule_line_identities',@value)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;",
            new { value = JsonSerializer.Serialize(ScheduleLineHistory.Freeze(history, ledger)) }, tx);
        await MaterialTrackingHistory.CaptureAsync(c, tx);
        tx.Commit();
        return Ok(new { ok = true, id, diff });
    }

    private static int CountJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return 0;
        try { using var d = JsonDocument.Parse(raw); return d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.GetArrayLength() : 0; }
        catch { return 0; }
    }

    private static async Task<List<ScheduleLineHistory.View>> LoadHistory(System.Data.IDbConnection c, System.Data.IDbTransaction? tx = null)
    {
        var snapshots = await LoadSnapshots(c, tx);
        return ScheduleLineHistory.Build(snapshots, await LoadLedger(c, tx));
    }

    private static async Task<ScheduleLineHistory.Ledger> LoadLedger(System.Data.IDbConnection c, System.Data.IDbTransaction? tx = null) =>
        ScheduleLineHistory.ReadLedger(await c.ExecuteScalarAsync<string?>(
            "SELECT value FROM settings WHERE key='schedule_line_identities'", transaction: tx));

    private static async Task<List<ScheduleLineHistory.Snapshot>> LoadSnapshots(System.Data.IDbConnection c, System.Data.IDbTransaction? tx = null)
    {
        var rows = await c.QueryAsync<(int id, string? week_label, DateTime? upload_date, string? raw_rows, string customer)>(
            "SELECT id, week_label, upload_date, raw_rows, customer FROM schedules", transaction: tx);
        return rows.Select(r => new ScheduleLineHistory.Snapshot(r.id, r.week_label, r.upload_date, r.raw_rows, r.customer)).ToList();
    }
}
