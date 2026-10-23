using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/material-alerts")]
public partial class MaterialAlertsController(ISqlConnectionFactory factory) : ControllerBase
{
    private static readonly Dictionary<string, string> CategoryAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["五金"] = "五金",
        ["吸塑"] = "吸塑",
        ["彩盒"] = "彩盒",
        ["彩盒/彩咭"] = "彩盒",
        ["彩咭"] = "彩盒",
        ["电子"] = "电子",
        ["电子类"] = "电子",
        ["电池"] = "电池",
        ["塑胶"] = "塑胶",
        ["塑胶件"] = "塑胶",
        ["搪胶"] = "搪胶",
        ["喷油"] = "喷油",
        ["电镀"] = "电镀",
        ["平卡"] = "平卡",
        ["其他外购"] = "其他外购",
        ["其它外购"] = "其他外购",
        ["其他类"] = "其他外购",
        ["其它类"] = "其他外购",
        ["化学品-其它"] = "其他外购",
    };

    [HttpGet("profiles")]
    public async Task<IActionResult> Profiles()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT id, product_code, product_name, category, component_name, lead_days, capacity_per_day,
                   source_name, active, updated_at
            FROM material_lead_profiles
            ORDER BY product_code, category");
        return Ok(rows);
    }

    public sealed class LeadProfileBody
    {
        public string? product_code { get; set; }
        public string? product_name { get; set; }
        public string? category { get; set; }
        public string? component_name { get; set; }
        public int? lead_days { get; set; }
        public decimal? capacity_per_day { get; set; }
        public string? source_name { get; set; }
        public bool? active { get; set; }
    }

    public sealed class ProductProfileBody
    {
        public string? product_code { get; set; }
        public string? product_name { get; set; }
        public bool? active { get; set; }
        public List<LeadProfileBody>? profiles { get; set; }
    }

    [HttpPut("profiles")]
    public async Task<IActionResult> SaveProfiles([FromBody] List<LeadProfileBody> body, [FromQuery] bool replace = false)
    {
        var rows = (body ?? [])
            .Where(x => !string.IsNullOrWhiteSpace(x.product_code) && !string.IsNullOrWhiteSpace(x.category))
            .Select(x => new
            {
                product_code = x.product_code!.Trim(),
                product_name = x.product_name?.Trim() ?? "",
                category = NormalizeCategory(x.category),
                component_name = x.component_name?.Trim() ?? "",
                lead_days = NormalizeLeadDays(x.category, x.lead_days, x.capacity_per_day),
                capacity_per_day = Math.Max(x.capacity_per_day ?? 0, 0),
                source_name = x.source_name?.Trim() ?? "手动维护",
                active = x.active ?? true,
            }).ToList();

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        if (replace && rows.Count > 0)
        {
            var productCodes = rows.Select(x => x.product_code).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            await c.ExecuteAsync(@"
                DELETE FROM material_lead_profiles
                WHERE product_code = ANY(@productCodes)", new { productCodes }, tx);
        }
        foreach (var row in rows)
        {
            await c.ExecuteAsync(@"
                INSERT INTO material_lead_profiles
                    (product_code, product_name, category, component_name, lead_days, capacity_per_day, source_name, active, updated_at)
                VALUES
                    (@product_code, @product_name, @category, @component_name, @lead_days, @capacity_per_day, @source_name, @active,
                     CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                ON CONFLICT (product_code, category, component_name) DO UPDATE SET
                    product_name=EXCLUDED.product_name,
                    lead_days=EXCLUDED.lead_days,
                    capacity_per_day=EXCLUDED.capacity_per_day,
                    source_name=EXCLUDED.source_name,
                    active=EXCLUDED.active,
                    updated_at=EXCLUDED.updated_at", row, tx);
        }
        tx.Commit();
        return Ok(new { ok = true, count = rows.Count });
    }

    [HttpPut("profiles/product")]
    public async Task<IActionResult> SaveProductProfile([FromBody] ProductProfileBody body)
    {
        var productCode = body.product_code?.Trim();
        if (string.IsNullOrWhiteSpace(productCode)) return BadRequest(new { message = "货号不能为空" });

        var productName = body.product_name?.Trim() ?? "";
        var active = body.active ?? true;
        var rows = (body.profiles ?? [])
            .Where(x => !string.IsNullOrWhiteSpace(x.category))
            .Select(x => new
            {
                product_code = productCode,
                product_name = productName,
                category = NormalizeCategory(x.category),
                component_name = x.component_name?.Trim() ?? "",
                lead_days = NormalizeLeadDays(x.category, x.lead_days, x.capacity_per_day),
                capacity_per_day = Math.Max(x.capacity_per_day ?? 0, 0),
                source_name = "系统手动维护",
                active,
            })
            .Where(x => x.lead_days > 0 || x.capacity_per_day > 0)
            .GroupBy(x => $"{x.category}|{x.component_name}", StringComparer.OrdinalIgnoreCase)
            .Select(x => x.Last())
            .ToList();

        if (rows.Count == 0) return BadRequest(new { message = "至少需要填写一个物料类别的交货周期或日产能" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync(@"
            DELETE FROM material_lead_profiles
            WHERE LOWER(product_code)=LOWER(@productCode)", new { productCode }, tx);
        foreach (var row in rows)
        {
            await c.ExecuteAsync(@"
                INSERT INTO material_lead_profiles
                    (product_code, product_name, category, component_name, lead_days, capacity_per_day, source_name, active, updated_at)
                VALUES
                    (@product_code, @product_name, @category, @component_name, @lead_days, @capacity_per_day, @source_name, @active,
                     CURRENT_TIMESTAMP AT TIME ZONE 'UTC')", row, tx);
        }
        tx.Commit();
        return Ok(new { ok = true, product_code = productCode, count = rows.Count });
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] long? revisionId = null)
    {
        var result = await BuildAlerts(revisionId);
        return result is null ? NotFound(new { message = "排期版本不存在" }) : Ok(result);
    }

    [HttpGet("history")]
    public async Task<IActionResult> History()
    {
        using var c = factory.Create();
        return Ok(await c.QueryAsync(@"
            SELECT id, schedule_id, week_label, upload_date, captured_at
            FROM material_tracking_history ORDER BY id DESC"));
    }

    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var result = await BuildAlerts() ?? new AlertResponse();
        return Ok(new
        {
            pending_critical = result.items.Count(x => x.status == "critical"),
            pending_warning = result.items.Count(x => x.status == "warning"),
            pending_normal = result.items.Count(x => x.status == "normal"),
            pending_unconfigured = result.items.Count(x => x.status == "unconfigured"),
            pending_total = result.items.Count(x => x.status is "critical" or "warning" or "normal"),
            schedule_label = result.schedule_label,
            accepted_basis = "排期订单接单日期",
        });
    }

    private async Task<AlertResponse?> BuildAlerts(long? revisionId = null)
    {
        using var c = factory.Create();
        var revisions = (await c.QueryAsync<MaterialTrackingHistory.Snapshot>(@"
            SELECT id,schedule_id,week_label,upload_date,raw_rows::text,rows_hash,
                   materials::text,products::text,acknowledged
            FROM material_tracking_history ORDER BY id")).ToList();
        var schedule = revisionId.HasValue ? revisions.FirstOrDefault(x => x.id == revisionId) : revisions.LastOrDefault();
        if (schedule is null) return revisionId.HasValue ? null : new AlertResponse();
        var completionRaw = await c.ExecuteScalarAsync<string?>(
            "SELECT value FROM settings WHERE key='material_tracking_completed_schedules'");
        // Historical views must not inherit confirmations from a later revision.
        if (revisionId.HasValue) revisions = revisions.Take(revisions.IndexOf(schedule) + 1).ToList();

        var profiles = (await c.QueryAsync<ProfileRow>(@"
            SELECT product_code, product_name, category, component_name, lead_days, capacity_per_day
            FROM material_lead_profiles WHERE active=TRUE")).ToList();
        var profileMap = profiles
            .GroupBy(x => $"{x.product_code.Trim()}|{NormalizeCategory(x.category)}", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);

        var materials = (await c.QueryAsync<MaterialRow>(@"
            SELECT id, product_code, item_no, name_zh, category, supplier,
                   COALESCE(NULLIF(usage_qty, 0), 1) AS usage_qty
            FROM materials
            WHERE active=TRUE
            ORDER BY product_code, sort_order, id")).ToList();

        var productionParts = new List<ProductionPartRow>();
        var productRows = await c.QueryAsync<ProductMoldingRow>(@"
            SELECT code, name, moldings FROM products
            WHERE active=TRUE
              AND NULLIF(BTRIM(moldings::text), '') IS NOT NULL
              AND BTRIM(moldings::text) <> '[]'");
        foreach (var product in productRows) productionParts.AddRange(ParseProductionParts(product));

        var productionPlan = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var moldingPoRaw = await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE \"key\"='moldingPOs'");
        if (!string.IsNullOrWhiteSpace(moldingPoRaw)) ParseProductionPlan(moldingPoRaw, productionPlan);

        var inventory = (await c.QueryAsync<InventoryRow>(@"
            WITH receipt_totals AS (
                SELECT po_item_id, SUM(qty) AS received_qty
                FROM po_receipts GROUP BY po_item_id
            ), outbound_totals AS (
                SELECT po_item_id, SUM(qty) AS outbound_qty
                FROM outbound WHERE po_item_id IS NOT NULL GROUP BY po_item_id
            )
            SELECT i.material_id,
                   SUM(COALESCE(i.purchase_qty,i.qty,0)) AS ordered_qty,
                   SUM(GREATEST(COALESCE(r.received_qty,0)-COALESCE(o.outbound_qty,0),0)) AS available_qty,
                   SUM(GREATEST(COALESCE(i.purchase_qty,i.qty,0)-COALESCE(r.received_qty,0),0)) AS in_transit_qty,
                   SUM(COALESCE(r.received_qty,0)) AS received_qty,
                   SUM(COALESCE(o.outbound_qty,0)) AS outbound_qty
            FROM po_items i
            LEFT JOIN receipt_totals r ON r.po_item_id=i.id
            LEFT JOIN outbound_totals o ON o.po_item_id=i.id
            WHERE i.material_id IS NOT NULL
            GROUP BY i.material_id")).ToDictionary(x => x.material_id);

        var aggregates = new Dictionary<int, DemandAggregate>();
        var productionAggregates = new Dictionary<string, ProductionDemandAggregate>(StringComparer.OrdinalIgnoreCase);
        var scheduleOrderNos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var demands = new Dictionary<string, TrackingDemand>(StringComparer.OrdinalIgnoreCase);
        var acknowledgements = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        HashSet<string> selectedKeys = new(StringComparer.OrdinalIgnoreCase);
        foreach (var revision in revisions)
        {
            // Keep historical BOMs immutable, but continue reflecting live library edits
            // in the current view. New material IDs never inherit old confirmations.
            var revisionMaterials = JsonSerializer.Deserialize<List<MaterialRow>>(revision.materials) ?? [];
            var revisionParts = new List<ProductionPartRow>();
            using (var productDoc = JsonDocument.Parse(revision.products))
                foreach (var product in productDoc.RootElement.EnumerateArray())
                    revisionParts.AddRange(ParseProductionParts(new ProductMoldingRow {
                        code = Text(product, "code"), name = Text(product, "name"),
                        moldings = product.TryGetProperty("moldings", out var molds) ? molds.GetRawText() : "[]"
                    }));
            var acknowledged = revision.acknowledged || MaterialTrackingHistory.MatchesCompletion(
                completionRaw, revision.schedule_id, revision.rows_hash);
            var frozenDemands = ExpandDemands(revision, revisionMaterials, revisionParts);
            if (acknowledged)
                foreach (var (key, demand) in frozenDemands)
                    acknowledgements[key] = Math.Max(acknowledgements.GetValueOrDefault(key), demand.required_qty);
            var revisionDemands = !revisionId.HasValue && revision.id == schedule.id
                ? ExpandDemands(revision, materials, productionParts) : frozenDemands;
            selectedKeys = revisionDemands.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);
            // An explicit zero cancels the order, including components removed from
            // the live BOM. Missing orders continue to retain their historical demand.
            var cancelledOrders = CancelledOrders(revision.raw_rows);
            foreach (var key in demands.Where(x => cancelledOrders.Contains(OrderIdentity(
                x.Value.customer, x.Value.order_no, x.Value.source_code))).Select(x => x.Key).ToArray())
                demands.Remove(key);
            foreach (var (key, demand) in revisionDemands)
            {
                // No reliable cross-schedule identity without an order number. Such rows
                // remain in their historical view rather than doubling current demand.
                if (demand.order_no.Length == 0 && revision.id != schedule.id) continue;
                demands[key] = demand;
            }
        }
        foreach (var (key, demand) in demands)
        {
            if (revisionId.HasValue && !selectedKeys.Contains(key)) continue;
            if (demand.required_qty <= 0) continue;
            if (demand.order_no.Length > 0) scheduleOrderNos.Add(JsonSerializer.Serialize(new[] { demand.customer, demand.order_no }));
            var manualQty = Math.Min(demand.required_qty, acknowledgements.GetValueOrDefault(key));
            var order = new OrderDemand {
                key = key,
                order_no = demand.order_no, product_code = demand.source_code, customer = demand.customer,
                accepted_date = demand.accepted_date, required_qty = demand.required_qty,
                manual_qty = manualQty, schedule_label = demand.schedule_label,
            };
            if (demand.material is { } material)
            {
                if (!aggregates.TryGetValue(material.id, out var agg))
                {
                    agg = new DemandAggregate { material = material, product_code = material.product_code ?? "",
                        accepted_date = demand.accepted_date };
                    aggregates[material.id] = agg;
                }
                agg.required_qty += demand.required_qty;
                if (demand.accepted_date < agg.accepted_date) agg.accepted_date = demand.accepted_date;
                agg.order_details[key] = order;
            }
            else if (demand.part is { } part)
            {
                if (!productionAggregates.TryGetValue(part.key, out var agg))
                {
                    agg = new ProductionDemandAggregate { part = part, accepted_date = demand.accepted_date };
                    productionAggregates[part.key] = agg;
                }
                agg.required_qty += demand.required_qty;
                if (demand.accepted_date < agg.accepted_date) agg.accepted_date = demand.accepted_date;
                agg.order_details[key] = order;
            }
        }

        var today = DateTime.Today;
        var items = new List<AlertItem>();
        foreach (var agg in aggregates.Values)
        {
            var material = agg.material;
            var normalizedCategory = NormalizeCategory(material.category);
            var profile = ResolveProfile(profileMap, agg.product_code, normalizedCategory, material.name_zh);
            inventory.TryGetValue(material.id, out var stock);
            var available = Math.Max(stock?.available_qty ?? 0, 0);
            var inTransit = Math.Max(stock?.in_transit_qty ?? 0, 0);
            var ordered = Math.Max(stock?.ordered_qty ?? 0, 0);
            var received = Math.Max(stock?.received_qty ?? 0, 0);
            var outbound = Math.Max(stock?.outbound_qty ?? 0, 0);
            var purchaseShortage = Math.Max(agg.required_qty - ordered, 0);
            var receiptShortage = Math.Max(agg.required_qty - received, 0);
            var outboundShortage = Math.Max(agg.required_qty - outbound, 0);
            var orderDetails = ToOrderDetails(agg.order_details, received, outbound, ordered);
            var timing = OutstandingTiming(orderDetails, profile);
            var completed = timing.accepted is null;
            DateTime? due = timing.due;
            var estimatedDays = due.HasValue ? (due.Value.Date - timing.accepted!.Value.Date).Days : 0;
            var daysRemaining = due.HasValue ? (due.Value.Date - today).Days : (int?)null;
            var status = completed
                ? "covered"
                : estimatedDays <= 0
                    ? "unconfigured"
                    : daysRemaining <= 3
                        ? "critical"
                        : daysRemaining <= 7
                            ? "warning"
                            : "normal";

            items.Add(new AlertItem
            {
                key = $"{agg.product_code}-{material.id}",
                product_code = agg.product_code,
                material_id = material.id,
                item_no = material.item_no ?? "",
                material_name = material.name_zh ?? "",
                category = material.category ?? "",
                lead_category = normalizedCategory,
                supplier = material.supplier ?? "",
                order_count = agg.order_details.Count,
                order_nos = agg.order_details.Values.Select(x => x.order_no).Where(x => x.Length > 0).Distinct().OrderBy(x => x).Take(8).ToArray(),
                order_details = orderDetails,
                accepted_date = timing.accepted?.ToString("yyyy-MM-dd") ?? "",
                due_date = due?.ToString("yyyy-MM-dd"),
                lead_days = profile?.lead_days,
                capacity_per_day = profile?.capacity_per_day ?? 0,
                required_qty = decimal.Round(agg.required_qty, 4),
                ordered_qty = decimal.Round(ordered, 4),
                available_qty = decimal.Round(available, 4),
                in_transit_qty = decimal.Round(inTransit, 4),
                received_qty = decimal.Round(received, 4),
                outbound_qty = decimal.Round(outbound, 4),
                purchase_shortage_qty = decimal.Round(purchaseShortage, 4),
                receipt_shortage_qty = decimal.Round(receiptShortage, 4),
                outbound_shortage_qty = decimal.Round(outboundShortage, 4),
                shortage_qty = decimal.Round(outboundShortage, 4),
                workflow_status = WorkflowStatus(agg.required_qty, ordered, received, outbound, false),
                days_remaining = daysRemaining,
                status = status,
                tracking_type = "purchase",
            });
        }

        foreach (var agg in productionAggregates.Values)
        {
            var part = agg.part;
            var profile = ResolveProfile(profileMap, part.product_code, part.category, part.name);
            productionPlan.TryGetValue(part.key, out var planned);
            var orderDetails = ToOrderDetails(agg.order_details, 0, 0, planned);
            var timing = OutstandingTiming(orderDetails, profile);
            DateTime? due = timing.due;
            var estimatedDays = due.HasValue ? (due.Value.Date - timing.accepted!.Value.Date).Days : 0;
            var daysRemaining = due.HasValue ? (due.Value.Date - today).Days : (int?)null;
            var status = timing.accepted is null ? "covered" : estimatedDays <= 0
                    ? "unconfigured"
                    : daysRemaining <= 3
                        ? "critical"
                        : daysRemaining <= 7
                            ? "warning"
                            : "normal";

            items.Add(new AlertItem
            {
                key = part.key,
                product_code = part.product_code,
                material_id = 0,
                item_no = part.item_no,
                material_name = part.name,
                category = part.category,
                lead_category = part.category,
                supplier = part.workshop,
                detail = part.detail,
                order_count = agg.order_details.Count,
                order_nos = agg.order_details.Values.Select(x => x.order_no).Where(x => x.Length > 0).Distinct().OrderBy(x => x).Take(8).ToArray(),
                order_details = orderDetails,
                accepted_date = timing.accepted?.ToString("yyyy-MM-dd") ?? "",
                due_date = due?.ToString("yyyy-MM-dd"),
                lead_days = profile?.lead_days > 0 ? profile.lead_days : estimatedDays > 0 ? estimatedDays : null,
                capacity_per_day = profile?.capacity_per_day ?? 0,
                required_qty = decimal.Round(agg.required_qty, 4),
                ordered_qty = decimal.Round(planned, 4),
                available_qty = 0,
                in_transit_qty = decimal.Round(planned, 4),
                received_qty = 0,
                outbound_qty = 0,
                purchase_shortage_qty = decimal.Round(Math.Max(agg.required_qty - planned, 0), 4),
                receipt_shortage_qty = decimal.Round(agg.required_qty, 4),
                outbound_shortage_qty = decimal.Round(agg.required_qty, 4),
                shortage_qty = decimal.Round(agg.required_qty, 4),
                workflow_status = WorkflowStatus(agg.required_qty, planned, 0, 0, true),
                days_remaining = daysRemaining,
                status = status,
                tracking_type = part.category == "搪胶" ? "vinyl" : "plastic",
            });
        }

        // Acknowledged quantities belong to an order/product/material, not an entire
        // upload. Use max, not addition, so real movements are never counted twice.
        foreach (var item in items)
        {
            var details = item.order_details;
            var manual = details.Sum(x => x.manual_qty_exact);
            var required = details.Sum(x => x.required_qty_exact);
            item.manual_completed = details.All(x => x.manually_covered);
            if (manual <= 0) continue;
            item.purchase_shortage_qty = decimal.Round(Math.Max(required - Math.Max(manual, item.ordered_qty), 0), 4);
            item.receipt_shortage_qty = decimal.Round(details.Sum(x => x.receipt_shortage_exact), 4);
            item.outbound_shortage_qty = item.shortage_qty = decimal.Round(details.Sum(x => x.outbound_shortage_exact), 4);
            if (details.All(x => x.receipt_shortage_exact == 0 && x.outbound_shortage_exact == 0))
            {
                item.status = "covered";
                item.workflow_status = item.manual_completed ? "已送完(手动)" : "已完成(含手动确认)";
            }
            else item.workflow_status = "部分已送完(手动)·" + item.workflow_status;
        }

        // Manual tracking adjustments are separate from business/stock records and
        // are never applied retrospectively to a historical schedule view.
        var adjustments = revisionId.HasValue ? new Dictionary<string, TrackingAdjustment>()
            : ReadAdjustments(await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE key=@AdjustmentKey", new { AdjustmentKey }));
        ApplyTrackingAdjustments(items, adjustments, profileMap, today);

        var statusOrder = new Dictionary<string, int>
        {
            ["critical"] = 0, ["warning"] = 1, ["normal"] = 2,
            ["unconfigured"] = 3, ["covered"] = 4,
        };
        items = items.OrderBy(x => statusOrder[x.status])
            .ThenBy(x => x.due_date ?? "9999-12-31")
            .ThenByDescending(x => x.shortage_qty)
            .ToList();

        return new AlertResponse
        {
            schedule_id = schedule.schedule_id,
            revision_id = revisionId,
            latest_revision_id = schedule.id,
            schedule_label = schedule.week_label ?? "",
            schedule_upload_date = schedule.upload_date?.ToString("yyyy-MM-dd"),
            order_count = scheduleOrderNos.Count,
            items = items,
        };
    }

    private static Dictionary<string, TrackingDemand> ExpandDemands(MaterialTrackingHistory.Snapshot revision,
        List<MaterialRow> materials, List<ProductionPartRow> parts)
    {
        var result = new Dictionary<string, TrackingDemand>(StringComparer.OrdinalIgnoreCase);
        var byCode = materials.GroupBy(x => x.product_code ?? "", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);
        var partsByCode = parts.GroupBy(x => x.product_code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);
        var codes = byCode.Keys.Union(partsByCode.Keys, StringComparer.OrdinalIgnoreCase).ToArray();
        using var doc = JsonDocument.Parse(revision.raw_rows ?? "[]");
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;
        var index = 0;
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            index++;
            if (row.ValueKind != JsonValueKind.Object) continue;
            var source = Text(row, "code");
            var code = ResolveCode(source, codes);
            if (code is null || source.Length == 0) continue;
            var orderNo = Text(row, "orderNo");
            var customer = Text(row, "customer");
            var accepted = ParseDate(Text(row, "orderDate")) ?? revision.upload_date?.Date ?? DateTime.Today;
            var qty = Math.Max(Number(row, "qty"), 0);
            void Add(string component, decimal usage, MaterialRow? material, ProductionPartRow? part)
            {
                // JSON tuple avoids delimiter collisions; keep the full source variant.
                var key = JsonSerializer.Serialize(new[] { customer, orderNo, source, component,
                    orderNo.Length == 0 ? $"{revision.id}:{index}" : "" });
                if (!result.TryGetValue(key, out var demand))
                {
                    demand = new TrackingDemand { order_no = orderNo, source_code = source, customer = customer,
                        accepted_date = accepted, material = material, part = part, schedule_label = revision.week_label ?? "" };
                    result[key] = demand;
                }
                demand.required_qty += qty * usage;
                if (accepted < demand.accepted_date) demand.accepted_date = accepted;
            }
            if (byCode.TryGetValue(code, out var matches))
                foreach (var material in matches) Add($"material:{material.id}", material.usage_qty, material, null);
            if (partsByCode.TryGetValue(code, out var partMatches))
                foreach (var part in partMatches) Add($"part:{part.key}", part.usage_qty, null, part);
        }
        return result;
    }

    private static string OrderIdentity(string customer, string orderNo, string sourceCode) =>
        JsonSerializer.Serialize(new[] { customer, orderNo, sourceCode });

    private static HashSet<string> CancelledOrders(string? raw)
    {
        var quantities = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        using var doc = JsonDocument.Parse(raw ?? "[]");
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object) continue;
                var orderNo = Text(row, "orderNo");
                var sourceCode = Text(row, "code");
                if (orderNo.Length == 0 || sourceCode.Length == 0) continue;
                var identity = OrderIdentity(Text(row, "customer"), orderNo, sourceCode);
                quantities[identity] = quantities.GetValueOrDefault(identity) + Math.Max(Number(row, "qty"), 0);
            }
        return quantities.Where(x => x.Value == 0).Select(x => x.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string NormalizeCategory(string? value)
    {
        var key = (value ?? "").Trim();
        return CategoryAliases.TryGetValue(key, out var normalized) ? normalized : key;
    }

    private static int NormalizeLeadDays(string? category, int? leadDays, decimal? capacityPerDay)
    {
        var normalized = NormalizeCategory(category);
        var days = Math.Max(leadDays ?? 0, 0);
        var capacity = Math.Max(capacityPerDay ?? 0, 0);
        return days == 0 && capacity > 0 && (normalized is "搪胶" or "喷油") ? 15 : days;
    }

    private static (DateTime? accepted, DateTime? due) OutstandingTiming(
        List<OrderDetail> details, ProfileRow? profile)
    {
        // Keep completed orders in history, but exclude them from deadline/risk calculations.
        // Manual confirmation and real movements cover the same quantity, never add them.
        var pending = details.Select(x => new {
            accepted = DateTime.ParseExact(x.accepted_date, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            remaining = Math.Max(x.receipt_shortage_exact, x.outbound_shortage_exact),
        }).Where(x => x.remaining > 0).ToList();
        if (pending.Count == 0) return (null, null);
        var accepted = pending.Min(x => x.accepted);
        // Preserve aggregate capacity scheduling, using only the outstanding workload.
        return (accepted, EstimateDeliveryDate(profile, accepted, pending.Sum(x => x.remaining)));
    }

    private static DateTime? EstimateDeliveryDate(ProfileRow? profile, DateTime acceptedDate, decimal requiredQty)
    {
        if (profile is null) return null;
        var preparationDays = Math.Max(profile.lead_days, 0);
        var productionDays = profile.capacity_per_day > 0
            ? (int)Math.Ceiling(Math.Max(requiredQty, 0) / profile.capacity_per_day)
            : 0;
        if (preparationDays <= 0 && productionDays <= 0) return null;
        var date = acceptedDate.Date.AddDays(preparationDays);
        while (productionDays > 0)
        {
            date = date.AddDays(1);
            if (date.DayOfWeek != DayOfWeek.Sunday) productionDays--;
        }
        return date;
    }

    private static List<OrderDetail> ToOrderDetails(
        IReadOnlyDictionary<string, OrderDemand> source,
        decimal receivedQty,
        decimal outboundQty,
        decimal orderedQty)
    {
        var receivedRemaining = Math.Max(receivedQty, 0);
        var outboundRemaining = Math.Max(outboundQty, 0);
        var orderedRemaining = Math.Max(orderedQty, 0);
        return source.Values.OrderBy(x => x.accepted_date).ThenBy(x => x.order_no).Select(x =>
        {
            var received = Math.Min(x.required_qty, receivedRemaining);
            var outbound = Math.Min(x.required_qty, outboundRemaining);
            var ordered = Math.Min(x.required_qty, orderedRemaining);
            receivedRemaining -= received;
            outboundRemaining -= outbound;
            orderedRemaining -= ordered;
            return new OrderDetail
            {
                key = x.key,
                order_no = x.order_no,
                product_code = x.product_code,
                customer = x.customer,
                schedule_label = x.schedule_label,
                manual_qty = decimal.Round(x.manual_qty, 4),
                required_qty_exact = x.required_qty,
                ordered_qty = ordered,
                source_required_qty = x.required_qty,
                source_ordered_qty = ordered,
                source_received_qty = received,
                source_outbound_qty = outbound,
                source_manual_qty = x.manual_qty,
                manual_qty_exact = x.manual_qty,
                manually_covered = x.manual_qty >= x.required_qty,
                receipt_shortage_exact = Math.Max(x.required_qty - Math.Max(x.manual_qty, received), 0),
                outbound_shortage_exact = Math.Max(x.required_qty - Math.Max(x.manual_qty, outbound), 0),
                accepted_date = x.accepted_date.ToString("yyyy-MM-dd"),
                required_qty = decimal.Round(x.required_qty, 4),
                received_qty = decimal.Round(received, 4),
                outbound_qty = decimal.Round(outbound, 4),
                status = x.manual_qty >= x.required_qty ? "已送完(手动)"
                    : outbound >= x.required_qty && received >= x.required_qty
                    ? "已完成"
                    : x.manual_qty > 0 ? "部分已送完(手动)"
                    : received >= x.required_qty
                        ? outbound > 0 ? "部分出库" : "已入库待出库"
                        : received > 0
                            ? outbound > 0 ? "部分入库·部分出库" : "部分入库"
                            : "待入库",
            };
        }).ToList();
    }

    private static string WorkflowStatus(decimal required, decimal ordered, decimal received, decimal outbound, bool production)
    {
        if (required <= 0) return "无需求";
        if (received >= required && outbound >= required) return "已完成";
        if (ordered <= 0) return production ? "未排产" : "未下单";
        var stages = new List<string> { production ? "已排产" : "已下单" };
        if (ordered < required) stages.Add(production ? "欠排产" : "欠采购");
        if (received <= 0) stages.Add("待入库");
        else if (received < required) stages.Add("部分入库");
        else stages.Add("已入库");
        if (received > 0)
        {
            if (outbound <= 0) stages.Add("待出库");
            else if (outbound < required) stages.Add("部分出库");
            else stages.Add("已出库");
        }
        return string.Join("·", stages);
    }

    private static ProfileRow? ResolveProfile(
        IReadOnlyDictionary<string, List<ProfileRow>> profiles,
        string productCode,
        string category,
        string? componentName)
    {
        if (!profiles.TryGetValue($"{productCode}|{NormalizeCategory(category)}", out var candidates)) return null;
        var target = NormalizeComponentName(componentName);
        if (!string.IsNullOrWhiteSpace(target))
        {
            var exact = candidates.FirstOrDefault(x => NormalizeComponentName(x.component_name) == target);
            if (exact is not null) return exact;
            var contains = candidates.FirstOrDefault(x =>
                !string.IsNullOrWhiteSpace(x.component_name) &&
                (target.Contains(NormalizeComponentName(x.component_name), StringComparison.OrdinalIgnoreCase) ||
                 NormalizeComponentName(x.component_name).Contains(target, StringComparison.OrdinalIgnoreCase)));
            if (contains is not null) return contains;
        }
        var common = candidates.FirstOrDefault(x => string.IsNullOrWhiteSpace(x.component_name));
        return common ?? (candidates.Count == 1 ? candidates[0] : null);
    }

    private static string NormalizeComponentName(string? value) =>
        new((value ?? "").Where(char.IsLetterOrDigit).ToArray());

    private static string? ResolveCode(string source, IEnumerable<string> knownCodes)
    {
        var text = source.Trim();
        var exact = knownCodes.FirstOrDefault(x => string.Equals(x, text, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact;
        if (text.Contains('/')) return null; // Composite item number: never use a shared prefix BOM.
        return knownCodes.Where(x => !string.IsNullOrWhiteSpace(x) && text.StartsWith(x, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.Length).FirstOrDefault();
    }

    private static IEnumerable<ProductionPartRow> ParseProductionParts(ProductMoldingRow product)
    {
        var result = new List<ProductionPartRow>();
        if (string.IsNullOrWhiteSpace(product.moldings)) return result;
        try
        {
            using var doc = JsonDocument.Parse(product.moldings);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;
            var moldIndex = 0;
            foreach (var mold in doc.RootElement.EnumerateArray())
            {
                moldIndex++;
                var moldId = Text(mold, "moldId");
                var moldName = Text(mold, "moldName");
                var workshop = Text(mold, "workshop");
                var materialName = Text(mold, "materialName");
                var parts = mold.TryGetProperty("parts", out var partsElement) && partsElement.ValueKind == JsonValueKind.Array
                    ? partsElement.EnumerateArray().ToArray()
                    : [];
                var category = parts.Length > 0 ? NormalizeCategory(Text(parts[0], "category")) : "";
                if (string.IsNullOrWhiteSpace(category)) category = materialName.Contains("搪胶") ? "搪胶" : "塑胶";
                if (category != "搪胶") category = "塑胶";

                if (category == "塑胶")
                {
                    var identity = string.IsNullOrWhiteSpace(moldId) ? $"mold-{moldIndex}" : moldId;
                    var details = parts.Select(x => StripPartPrefix(Text(x, "partName")))
                        .Where(x => !string.IsNullOrWhiteSpace(x));
                    result.Add(new ProductionPartRow
                    {
                        key = ProductionKey(product.code, category, identity, ""),
                        product_code = product.code,
                        category = category,
                        item_no = moldId,
                        name = string.IsNullOrWhiteSpace(moldName) ? identity : moldName,
                        workshop = workshop,
                        detail = string.Join(" / ", details),
                        usage_qty = 1,
                    });
                    continue;
                }

                var partIndex = 0;
                foreach (var part in parts)
                {
                    partIndex++;
                    var partCode = Text(part, "partCode");
                    var partName = StripPartPrefix(Text(part, "partName"));
                    var identity = !string.IsNullOrWhiteSpace(partCode)
                        ? partCode
                        : !string.IsNullOrWhiteSpace(partName) ? partName : $"part-{partIndex}";
                    result.Add(new ProductionPartRow
                    {
                        key = ProductionKey(product.code, category, moldId, identity),
                        product_code = product.code,
                        category = category,
                        item_no = partCode,
                        name = string.IsNullOrWhiteSpace(partName) ? moldName : partName,
                        workshop = workshop,
                        detail = moldName,
                        usage_qty = Math.Max(Number(part, "usage"), 1),
                    });
                }
            }
        }
        catch { }
        return result;
    }

    private static void ParseProductionPlan(string raw, Dictionary<string, decimal> target)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return;
            foreach (var po in doc.RootElement.EnumerateArray())
            {
                var category = NormalizeCategory(Text(po, "category"));
                if (category != "搪胶") category = "塑胶";
                if (!po.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in items.EnumerateArray())
                {
                    var code = Text(item, "code");
                    if (string.IsNullOrWhiteSpace(code)) continue;
                    var moldId = Text(item, "moldId");
                    var partCode = Text(item, "partCode");
                    var identity = category == "搪胶"
                        ? !string.IsNullOrWhiteSpace(partCode) ? partCode : StripPartPrefix(Text(item, "partName"))
                        : "";
                    if (category == "塑胶" && string.IsNullOrWhiteSpace(moldId)) continue;
                    var key = ProductionKey(code, category, moldId, identity);
                    target[key] = target.GetValueOrDefault(key) + Math.Max(Number(item, "qty"), 0);
                }
            }
        }
        catch { }
    }

    private static string ProductionKey(string code, string category, string moldId, string identity) =>
        category == "搪胶"
            ? $"{code}|{category}|{moldId}|{identity}"
            : $"{code}|{category}|{moldId}";

    private static string StripPartPrefix(string value) => value
        .Replace("塑胶件-", "", StringComparison.OrdinalIgnoreCase)
        .Replace("搪胶件-", "", StringComparison.OrdinalIgnoreCase)
        .Trim();

    private static string Text(JsonElement row, string name) =>
        row.TryGetProperty(name, out var value) && value.ValueKind is not JsonValueKind.Null
            ? value.ToString().Trim()
            : "";

    private static decimal Number(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var value)) return 0;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)) return number;
        return decimal.TryParse(value.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out number) ? number : 0;
    }

    private static DateTime? ParseDate(string text) =>
        DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var date)
            ? date.Date
            : null;

    private sealed class ProductMoldingRow
    {
        public string code { get; set; } = "";
        public string? name { get; set; }
        public string? moldings { get; set; }
    }

    private sealed class ProductionPartRow
    {
        public string key { get; set; } = "";
        public string product_code { get; set; } = "";
        public string category { get; set; } = "";
        public string item_no { get; set; } = "";
        public string name { get; set; } = "";
        public string workshop { get; set; } = "";
        public string detail { get; set; } = "";
        public decimal usage_qty { get; set; }
    }

    private sealed class ProfileRow
    {
        public string product_code { get; set; } = "";
        public string product_name { get; set; } = "";
        public string category { get; set; } = "";
        public string component_name { get; set; } = "";
        public int lead_days { get; set; }
        public decimal capacity_per_day { get; set; }
    }

    private sealed class MaterialRow
    {
        public int id { get; set; }
        public string? product_code { get; set; }
        public string? item_no { get; set; }
        public string? name_zh { get; set; }
        public string? category { get; set; }
        public string? supplier { get; set; }
        public decimal usage_qty { get; set; }
    }

    private sealed class InventoryRow
    {
        public int material_id { get; set; }
        public decimal ordered_qty { get; set; }
        public decimal available_qty { get; set; }
        public decimal in_transit_qty { get; set; }
        public decimal received_qty { get; set; }
        public decimal outbound_qty { get; set; }
    }

    private sealed class DemandAggregate
    {
        public MaterialRow material { get; set; } = new();
        public string product_code { get; set; } = "";
        public DateTime accepted_date { get; set; }
        public decimal required_qty { get; set; }
        public Dictionary<string, OrderDemand> order_details { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class ProductionDemandAggregate
    {
        public ProductionPartRow part { get; set; } = new();
        public DateTime accepted_date { get; set; }
        public decimal required_qty { get; set; }
        public Dictionary<string, OrderDemand> order_details { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class OrderDemand
    {
        public string key { get; set; } = "";
        public string order_no { get; set; } = "";
        public string product_code { get; set; } = "";
        public string customer { get; set; } = "";
        public string schedule_label { get; set; } = "";
        public decimal manual_qty { get; set; }
        public DateTime accepted_date { get; set; }
        public decimal required_qty { get; set; }
    }

    private sealed class OrderDetail
    {
        public decimal source_required_qty { get; set; }
        public decimal source_ordered_qty { get; set; }
        public decimal source_received_qty { get; set; }
        public decimal source_outbound_qty { get; set; }
        public decimal source_manual_qty { get; set; }
        public decimal ordered_qty { get; set; }
        public long adjustment_version { get; set; }
        public TrackingAdjustment? adjustment { get; set; }
        [JsonIgnore] public decimal required_qty_exact { get; set; }
        [JsonIgnore] public decimal manual_qty_exact { get; set; }
        [JsonIgnore] public bool manually_covered { get; set; }
        [JsonIgnore] public decimal receipt_shortage_exact { get; set; }
        [JsonIgnore] public decimal outbound_shortage_exact { get; set; }
        public string key { get; set; } = "";
        public string order_no { get; set; } = "";
        public string product_code { get; set; } = "";
        public string customer { get; set; } = "";
        public string schedule_label { get; set; } = "";
        public decimal manual_qty { get; set; }
        public string accepted_date { get; set; } = "";
        public decimal required_qty { get; set; }
        public decimal received_qty { get; set; }
        public decimal outbound_qty { get; set; }
        public string status { get; set; } = "";
    }

    private sealed class AlertResponse
    {
        public long? latest_revision_id { get; set; }
        public long? revision_id { get; set; }
        public int? schedule_id { get; set; }
        public string schedule_label { get; set; } = "";
        public string? schedule_upload_date { get; set; }
        public int order_count { get; set; }
        public List<AlertItem> items { get; set; } = [];
    }

    private sealed class TrackingDemand
    {
        public string order_no { get; set; } = "";
        public string source_code { get; set; } = "";
        public string customer { get; set; } = "";
        public string schedule_label { get; set; } = "";
        public DateTime accepted_date { get; set; }
        public decimal required_qty { get; set; }
        public MaterialRow? material { get; set; }
        public ProductionPartRow? part { get; set; }
    }

    private sealed class AlertItem
    {
        public bool has_adjustments { get; set; }
        public decimal source_required_qty { get; set; }
        public decimal source_ordered_qty { get; set; }
        public decimal source_received_qty { get; set; }
        public decimal source_outbound_qty { get; set; }
        public string key { get; set; } = "";
        public string product_code { get; set; } = "";
        public int material_id { get; set; }
        public string item_no { get; set; } = "";
        public string material_name { get; set; } = "";
        public string category { get; set; } = "";
        public string lead_category { get; set; } = "";
        public string supplier { get; set; } = "";
        public int order_count { get; set; }
        public string[] order_nos { get; set; } = [];
        public List<OrderDetail> order_details { get; set; } = [];
        public string accepted_date { get; set; } = "";
        public string? due_date { get; set; }
        public int? lead_days { get; set; }
        public decimal required_qty { get; set; }
        public decimal ordered_qty { get; set; }
        public decimal available_qty { get; set; }
        public decimal in_transit_qty { get; set; }
        public decimal received_qty { get; set; }
        public decimal outbound_qty { get; set; }
        public decimal purchase_shortage_qty { get; set; }
        public decimal receipt_shortage_qty { get; set; }
        public decimal outbound_shortage_qty { get; set; }
        public decimal shortage_qty { get; set; }
        public bool manual_completed { get; set; }
        public string workflow_status { get; set; } = "";
        public int? days_remaining { get; set; }
        public string status { get; set; } = "";
        public string tracking_type { get; set; } = "purchase";
        public string detail { get; set; } = "";
        public decimal capacity_per_day { get; set; }
    }
}
