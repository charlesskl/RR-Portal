using System.Globalization;
using System.Text.Json;
using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/material-alerts")]
public class MaterialAlertsController(ISqlConnectionFactory factory) : ControllerBase
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
    public async Task<IActionResult> List()
    {
        var result = await BuildAlerts();
        return Ok(result);
    }

    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var result = await BuildAlerts();
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

    private async Task<AlertResponse> BuildAlerts()
    {
        using var c = factory.Create();
        var schedule = await c.QueryFirstOrDefaultAsync<ScheduleRow>(@"
            SELECT id, week_label, upload_date, raw_rows
            FROM schedules
            ORDER BY upload_date DESC NULLS LAST, id DESC
            LIMIT 1");
        if (schedule is null || string.IsNullOrWhiteSpace(schedule.raw_rows))
            return new AlertResponse();

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
        var materialByCode = materials.GroupBy(x => x.product_code ?? "", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);

        var productionParts = new List<ProductionPartRow>();
        var productRows = await c.QueryAsync<ProductMoldingRow>(@"
            SELECT code, name, moldings FROM products
            WHERE active=TRUE AND moldings IS NOT NULL AND moldings <> '[]'::jsonb");
        foreach (var product in productRows) productionParts.AddRange(ParseProductionParts(product));
        var productionByCode = productionParts.GroupBy(x => x.product_code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);

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
        var knownCodes = materialByCode.Keys.Union(productionByCode.Keys, StringComparer.OrdinalIgnoreCase).ToArray();
        using var doc = JsonDocument.Parse(schedule.raw_rows);
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                var sourceCode = Text(row, "code");
                if (string.IsNullOrWhiteSpace(sourceCode)) continue;
                var code = ResolveCode(sourceCode, knownCodes);
                if (code is null) continue;
                var qty = Number(row, "qty");
                if (qty <= 0) continue;
                var orderNo = Text(row, "orderNo");
                if (!string.IsNullOrWhiteSpace(orderNo)) scheduleOrderNos.Add(orderNo);
                var accepted = ParseDate(Text(row, "orderDate")) ?? schedule.upload_date?.Date ?? DateTime.Today;

                if (materialByCode.TryGetValue(code, out var productMaterials))
                {
                    foreach (var material in productMaterials)
                    {
                        if (!aggregates.TryGetValue(material.id, out var agg))
                        {
                            agg = new DemandAggregate
                            {
                                material = material,
                                product_code = code,
                                accepted_date = accepted,
                            };
                            aggregates[material.id] = agg;
                        }
                        var materialDemand = qty * material.usage_qty;
                        agg.required_qty += materialDemand;
                        agg.accepted_date = accepted < agg.accepted_date ? accepted : agg.accepted_date;
                        AddOrderDetail(agg.order_details, orderNo, accepted, materialDemand);
                    }
                }

                if (productionByCode.TryGetValue(code, out var productParts))
                {
                    foreach (var part in productParts)
                    {
                        if (!productionAggregates.TryGetValue(part.key, out var agg))
                        {
                            agg = new ProductionDemandAggregate { part = part, accepted_date = accepted };
                            productionAggregates[part.key] = agg;
                        }
                        var productionDemand = qty * part.usage_qty;
                        agg.required_qty += productionDemand;
                        agg.accepted_date = accepted < agg.accepted_date ? accepted : agg.accepted_date;
                        AddOrderDetail(agg.order_details, orderNo, accepted, productionDemand);
                    }
                }
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
            var completed = received >= agg.required_qty && outbound >= agg.required_qty;
            DateTime? due = EstimateDeliveryDate(profile, agg.accepted_date, agg.required_qty);
            var estimatedDays = due.HasValue ? (due.Value.Date - agg.accepted_date.Date).Days : 0;
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
                order_nos = agg.order_details.Keys.OrderBy(x => x).Take(8).ToArray(),
                order_details = ToOrderDetails(agg.order_details, received, outbound),
                accepted_date = agg.accepted_date.ToString("yyyy-MM-dd"),
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
            DateTime? due = EstimateDeliveryDate(profile, agg.accepted_date, agg.required_qty);
            var estimatedDays = due.HasValue ? (due.Value.Date - agg.accepted_date.Date).Days : 0;
            var daysRemaining = due.HasValue ? (due.Value.Date - today).Days : (int?)null;
            var status = estimatedDays <= 0
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
                order_nos = agg.order_details.Keys.OrderBy(x => x).Take(8).ToArray(),
                order_details = ToOrderDetails(agg.order_details, 0, 0),
                accepted_date = agg.accepted_date.ToString("yyyy-MM-dd"),
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
            schedule_id = schedule.id,
            schedule_label = schedule.week_label ?? "",
            schedule_upload_date = schedule.upload_date?.ToString("yyyy-MM-dd"),
            order_count = scheduleOrderNos.Count,
            items = items,
        };
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

    private static void AddOrderDetail(
        IDictionary<string, OrderDemand> target,
        string? orderNo,
        DateTime acceptedDate,
        decimal requiredQty)
    {
        if (string.IsNullOrWhiteSpace(orderNo)) return;
        if (!target.TryGetValue(orderNo, out var detail))
        {
            target[orderNo] = new OrderDemand { order_no = orderNo, accepted_date = acceptedDate, required_qty = requiredQty };
            return;
        }
        detail.required_qty += requiredQty;
        if (acceptedDate < detail.accepted_date) detail.accepted_date = acceptedDate;
    }

    private static List<OrderDetail> ToOrderDetails(
        IReadOnlyDictionary<string, OrderDemand> source,
        decimal receivedQty,
        decimal outboundQty)
    {
        var receivedRemaining = Math.Max(receivedQty, 0);
        var outboundRemaining = Math.Max(outboundQty, 0);
        return source.Values.OrderBy(x => x.accepted_date).ThenBy(x => x.order_no).Select(x =>
        {
            var received = Math.Min(x.required_qty, receivedRemaining);
            var outbound = Math.Min(x.required_qty, outboundRemaining);
            receivedRemaining -= received;
            outboundRemaining -= outbound;
            return new OrderDetail
            {
                order_no = x.order_no,
                accepted_date = x.accepted_date.ToString("yyyy-MM-dd"),
                required_qty = decimal.Round(x.required_qty, 4),
                received_qty = decimal.Round(received, 4),
                outbound_qty = decimal.Round(outbound, 4),
                status = outbound >= x.required_qty && received >= x.required_qty
                    ? "已完成"
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

    private sealed class ScheduleRow
    {
        public int id { get; set; }
        public string? week_label { get; set; }
        public DateTime? upload_date { get; set; }
        public string? raw_rows { get; set; }
    }

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
        public string order_no { get; set; } = "";
        public DateTime accepted_date { get; set; }
        public decimal required_qty { get; set; }
    }

    private sealed class OrderDetail
    {
        public string order_no { get; set; } = "";
        public string accepted_date { get; set; } = "";
        public decimal required_qty { get; set; }
        public decimal received_qty { get; set; }
        public decimal outbound_qty { get; set; }
        public string status { get; set; } = "";
    }

    private sealed class AlertResponse
    {
        public int? schedule_id { get; set; }
        public string schedule_label { get; set; } = "";
        public string? schedule_upload_date { get; set; }
        public int order_count { get; set; }
        public List<AlertItem> items { get; set; } = [];
    }

    private sealed class AlertItem
    {
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
        public string workflow_status { get; set; } = "";
        public int? days_remaining { get; set; }
        public string status { get; set; } = "";
        public string tracking_type { get; set; } = "purchase";
        public string detail { get; set; } = "";
        public decimal capacity_per_day { get; set; }
    }
}
