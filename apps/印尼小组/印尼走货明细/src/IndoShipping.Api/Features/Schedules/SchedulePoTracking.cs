using IndoShipping.Api.Features.Purchasing;

namespace IndoShipping.Api.Features.Schedules;

// Read-only projections: a material name or a PO substring is never an allocation key.
public static class SchedulePoTracking
{
    public sealed record Identity(string Customer, string Source, string OrderNo, string Code);
    public sealed class PurchaseLine
    {
        public int Id { get; init; }
        public int PoId { get; init; }
        public string PoNo { get; init; } = "";
        public string? SourcePoNo { get; init; }
        public string? ProductCode { get; init; }
        public string? OrderNos { get; init; }
        public int? MaterialId { get; init; }
        public string? MaterialName { get; init; }
        public string? Spec { get; init; }
        public string? Supplier { get; init; }
        public string? Unit { get; init; }
        public decimal PurchaseQty { get; init; }
        public decimal ReceivedQty { get; init; }
        public decimal SpareQty { get; init; }
        public decimal OutboundQty { get; init; }
    }
    public sealed class Movement
    {
        public int Id { get; init; }
        public int ShipmentId { get; init; }
        public int? PoItemId { get; init; }
        public int? OutboundId { get; init; }
        public decimal? OutboundQty { get; init; }
        public int? OutboundMaterialId { get; init; }
        public int? MaterialId { get; init; }
        public string? PoNo { get; init; }
        public string? Unit { get; init; }
        public decimal Qty { get; init; }
        public bool HasQuantity { get; init; } = true;
        public string Status { get; init; } = "";
        public string? ContainerNo { get; init; }
        public DateTime? ShipDate { get; init; }
        public DateTime? LoadDate { get; init; }
        public DateTime? OutDate { get; init; }
    }
    public sealed class Record
    {
        public int shipment_item_id { get; init; }
        public int shipment_id { get; init; }
        public int? outbound_id { get; init; }
        public string? container_no { get; init; }
        public string status { get; init; } = "";
        public DateTime? ship_date { get; init; }
        public DateTime? load_date { get; init; }
        public DateTime? out_date { get; init; }
        public decimal? qty { get; init; }
        public string? unit { get; init; }
        public decimal? regular_qty { get; set; }
        public decimal? spare_qty { get; set; }
        public bool counted { get; set; }
        public List<string> issues { get; init; } = [];
    }
    public sealed class Material
    {
        public int po_item_id { get; init; }
        public int po_id { get; init; }
        public string po_no { get; init; } = "";
        public string? source_po_no { get; init; }
        public int? material_id { get; init; }
        public string? material_name { get; init; }
        public string? spec { get; init; }
        public string? supplier { get; init; }
        public string? unit { get; init; }
        public string? linked_order_nos { get; init; }
        public decimal? purchase_qty { get; init; }
        public decimal? received_qty { get; init; }
        public decimal? received_spare_qty { get; init; }
        public decimal? outbound_qty { get; init; }
        public decimal? shipped_qty { get; set; }
        public decimal? shipped_spare_qty { get; set; }
        public decimal? pending_qty { get; set; }
        public decimal? pending_spare_qty { get; set; }
        public decimal? remaining_qty { get; set; }
        public string status { get; set; } = "review";
        public List<string> issues { get; init; } = [];
        public List<Record> records { get; init; } = [];
    }

    static string Key(string? value) => (value ?? "").Trim().ToUpperInvariant();
    public static string Source(string? value) => Key(value) == "RRM" ? "RRM" : "RRI";
    public static Identity Normalize(Identity value) => new(PurchaseCustomerIsolation.Normalize(value.Customer).ToUpperInvariant(),
        Source(value.Source), Key(value.OrderNo), Key(value.Code));
    static HashSet<string> Orders(string? value) => (value ?? "").Split([';', '；'])
        .Select(Key).Where(v => v.Length > 0).ToHashSet();
    static string? Prefix(string? value) => Key(value).StartsWith("IRRM") ? "RRM"
        : Key(value).StartsWith("IRRI") ? "RRI" : null;
    static string Unit(string? value) => Key(value) switch
    {
        "" or "个" or "件" or "PCS" or "PCE" or "PC" => "PCE",
        "KGM" or "KG" or "千克" or "公斤" => "KGM",
        "ROLL" or "ROL" or "卷" => "ROL",
        "SET" or "套" => "SET",
        "TNE" or "吨" => "TNE",
        "MTR" or "M" or "米" => "MTR",
        _ => Key(value),
    };

    public static List<Material> Build(Identity requested, IReadOnlyList<Identity> history,
        IReadOnlyList<PurchaseLine> purchases, IReadOnlyList<Movement> movements)
    {
        var target = Normalize(requested);
        var evidence = history.Select(Normalize).Distinct().ToList();
        var knownCodes = history.Select(v => v.Code).Append(requested.Code).ToArray();
        var overallocated = movements.Where(m => m.OutboundId.HasValue).GroupBy(m => m.OutboundId)
            .Where(g => g.Any(m => !m.OutboundQty.HasValue) || g.Sum(m => Math.Max(0, m.Qty)) > g.First().OutboundQty)
            .Select(g => g.Key).ToHashSet();
        var result = new List<Material>();
        foreach (var line in purchases)
        {
            var codes = PurchaseCustomerIsolation.Codes(line.ProductCode, knownCodes).Select(Key).ToHashSet();
            var orders = Orders(line.OrderNos);
            if (!codes.Contains(target.Code) || orders.Count > 0 && !orders.Contains(target.OrderNo)) continue;
            var prefix = Prefix(string.IsNullOrWhiteSpace(line.SourcePoNo) ? line.PoNo : line.SourcePoNo);
            if (prefix is not null && prefix != target.Source) continue;
            var owners = evidence.Where(e => codes.Contains(e.Code) && (orders.Count == 0 || orders.Contains(e.OrderNo)))
                .Where(e => prefix is null || e.Source == prefix).Select(e => (e.Customer, e.Source)).Distinct().ToList();
            if (owners.Count > 0 && !owners.Contains((target.Customer, target.Source))) continue;
            var associationIssues = new List<string>();
            if (orders.Count == 0) associationIssues.Add("采购明细未关联排期 PO，待核对");
            if (orders.Count > 1 || codes.Count > 1) associationIssues.Add("多个排期 PO 或货号共用采购明细，未记录各自分配数量，待分配");
            if (owners.Count != 1) associationIssues.Add("采购明细的客户或 RRI/RRM 来源不唯一，待核对");
            var assigned = associationIssues.Count == 0;
            var material = new Material
            {
                po_item_id = line.Id, po_id = line.PoId, po_no = line.PoNo, source_po_no = line.SourcePoNo,
                material_id = line.MaterialId, material_name = line.MaterialName, spec = line.Spec, supplier = line.Supplier,
                unit = line.Unit, linked_order_nos = line.OrderNos,
                purchase_qty = assigned ? line.PurchaseQty : null, received_qty = assigned ? line.ReceivedQty : null,
                received_spare_qty = assigned ? line.SpareQty : null, outbound_qty = assigned ? line.OutboundQty : null,
                issues = associationIssues,
            };
            var aliases = new[] { line.PoNo, line.SourcePoNo }.Select(Key).Where(v => v.Length > 0).ToHashSet();
            var related = movements.Where(m => m.PoItemId == line.Id || !m.PoItemId.HasValue
                && line.MaterialId.HasValue && m.MaterialId == line.MaterialId && Orders(m.PoNo).Overlaps(aliases))
                .OrderBy(m => m.Status is "shipped" or "arrived" ? 0 : m.Status == "loaded" ? 1 : 2)
                .ThenBy(m => m.ShipmentId).ThenBy(m => m.Id).ToList();
            foreach (var movement in related)
            {
                var issues = new List<string>();
                var active = movement.Status is "shipped" or "arrived" or "loaded";
                if (movement.PoItemId != line.Id) issues.Add("未关联到该采购明细的具体出库批次，未计入");
                if (!movement.OutboundId.HasValue) issues.Add("缺少具体出库批次，未计入");
                if (!line.MaterialId.HasValue || movement.MaterialId != line.MaterialId || movement.OutboundMaterialId != line.MaterialId)
                    issues.Add("货柜、出库与采购的物料关联不一致，未计入");
                if (Unit(movement.Unit) != Unit(line.Unit)) issues.Add("货柜数量单位与采购单位不同，未计入");
                if (!movement.HasQuantity || movement.Qty < 0) issues.Add("走货数量缺失或无效，未计入");
                if (movement.OutboundId.HasValue && overallocated.Contains(movement.OutboundId)) issues.Add("该出库批次的货柜分配超过出库数量，待核对");
                if (!active && movement.Status != "draft") issues.Add("货柜状态无法确认，未计入");
                if (active || movement.Status != "draft") material.issues.AddRange(issues);
                material.records.Add(new Record
                {
                    shipment_item_id = movement.Id, shipment_id = movement.ShipmentId, outbound_id = movement.OutboundId,
                    container_no = movement.ContainerNo, status = movement.Status, ship_date = movement.ShipDate,
                    load_date = movement.LoadDate, out_date = movement.OutDate, qty = movement.HasQuantity ? movement.Qty : null, unit = movement.Unit,
                    issues = issues,
                });
            }
            if (assigned && line.PurchaseQty <= 0) material.issues.Add("采购数量未填写，待核对");
            var activeRecords = material.records.Where(r => r.status is "shipped" or "arrived" or "loaded").ToList();
            if (assigned && activeRecords.Sum(r => r.qty ?? 0) > line.ReceivedQty + line.SpareQty)
                material.issues.Add("已装箱及已走货数量超过累计入库，无法确认正品和备品数量");
            if (material.issues.Count == 0)
            {
                var regular = line.ReceivedQty;
                // There is no per-outbound spare flag in legacy data. Follow the existing
                // receipt basis: shipped stock first, then loaded stock; regular before spares.
                foreach (var record in activeRecords)
                {
                    record.regular_qty = Math.Min(record.qty ?? 0, regular);
                    record.spare_qty = (record.qty ?? 0) - record.regular_qty;
                    regular -= record.regular_qty.Value;
                    record.counted = true;
                }
                var shipped = activeRecords.Where(r => r.status is "shipped" or "arrived").Sum(r => r.regular_qty ?? 0);
                material.shipped_qty = shipped;
                material.shipped_spare_qty = activeRecords.Where(r => r.status is "shipped" or "arrived").Sum(r => r.spare_qty);
                material.pending_qty = activeRecords.Where(r => r.status == "loaded").Sum(r => r.regular_qty);
                material.pending_spare_qty = activeRecords.Where(r => r.status == "loaded").Sum(r => r.spare_qty);
                material.remaining_qty = Math.Max(0, line.PurchaseQty - shipped);
                material.status = material.remaining_qty == 0 ? "complete" : material.shipped_qty > 0 ? "partial" : "unshipped";
            }
            result.Add(material);
        }
        return result;
    }
}
