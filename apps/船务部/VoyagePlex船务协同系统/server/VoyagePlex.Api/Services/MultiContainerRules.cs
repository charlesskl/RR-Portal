using System.Globalization;
using System.Text.Json.Nodes;

namespace VoyagePlex.Api.Services;

public static class MultiContainerRules
{
    private const int MeasurementPrecision = 6;
    public static List<(string GroupKey, JsonObject Payload)> Split(JsonObject stored)
    {
        var groups = stored["shipment_groups"]?.AsArray() ?? [];
        if (groups.Count < 2 || groups.Count > 100) throw new InvalidOperationException("多柜安排须包含2至100个柜");
        if (stored["fields"] is not JsonObject || groups.Any(g => g is not JsonObject ||
            string.IsNullOrWhiteSpace(g["group_key"]?.ToString()) || string.IsNullOrWhiteSpace(g["so_number"]?.ToString())))
            throw new InvalidOperationException("分柜安排缺少SO号或分组信息");
        if (groups.Select(g => g!["group_key"]!.ToString()).Distinct().Count() != groups.Count)
            throw new InvalidOperationException("分柜分组不能重复");
        var items = stored["items"]?.AsArray() ?? [];
        if (items.Any(item => item is not JsonObject)) throw new InvalidOperationException("产品资料格式不正确");
        var result = groups.Select(node =>
        {
            var group = node!.AsObject();
            var payload = stored.DeepClone().AsObject();
            payload["items"] = new JsonArray(); payload["warehouse_groups"] = new JsonArray();
            var fields = payload["fields"]!.AsObject();
            foreach (var key in new[] { "so_number", "container_type", "si_deadline", "cutoff_date", "vessel_name" })
                fields[key] = group[key]?.DeepClone();
            payload["so_numbers"] = new JsonArray(group["so_number"]?.ToString());
            fields["export_template"] = items.Count > 0 ? stored["fields"]?["export_template"]?.DeepClone() : null;
            return (GroupKey: group["group_key"]!.ToString(), Payload: payload);
        }).ToList();
        if (items.Count == 0) return result;
        decimal Read(JsonNode? value) => decimal.TryParse(value?.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var number) ? number : 0;
        var total = 0;
        string OrderKey(JsonNode? item) => $"{item?["customer_po"]}|{item?["contract_number"]}|{item?["order_reference"]}";
        var orderTotals = new Dictionary<string, int>();
        foreach (var item in items)
        {
            var boxes = Read(item?["pieces"]);
            if (boxes <= 0 || boxes != decimal.Truncate(boxes) || boxes > int.MaxValue)
                throw new InvalidOperationException("分柜前请填写每种产品的整批整数箱数");
            total = checked(total + (int)boxes);
            var orderKey = OrderKey(item);
            orderTotals[orderKey] = checked(orderTotals.GetValueOrDefault(orderKey) + (int)boxes);
        }
        if (total < groups.Count) throw new InvalidOperationException("总箱数少于柜数，请核对分柜安排");
        var mixedSizes = groups.Select(g => g?["container_type"]?.ToString()).Distinct().Count() > 1;
        var capacities = groups.Select(g => Read(g?["capacity_boxes"])).ToArray();
        if (mixedSizes && capacities.Any(c => c <= 0)) throw new InvalidOperationException("不同柜型须填写各柜可装箱数");
        if (capacities.Any(c => c < 0 || c != decimal.Truncate(c))) throw new InvalidOperationException("柜容量须为整数箱数");
        if (capacities.Any(c => c > 0) && capacities.Any(c => c <= 0)) throw new InvalidOperationException("请补齐所有柜容量，或同柜型全部留空按平均分配");
        if (capacities.All(c => c > 0) && capacities.Sum() < total) throw new InvalidOperationException("柜容量不足，请核对总箱数或柜安排");
        // Equal cabinets share total cartons with remainder assigned first. Explicit
        // capacities are limits; proportional targets keep differently sized cabinets balanced.
        var weightSum = capacities.Sum();
        var targets = capacities.All(c => c == 0)
            ? Enumerable.Range(0, groups.Count).Select(i => total / groups.Count + (i < total % groups.Count ? 1 : 0)).ToArray()
            : capacities.Select(c => (int)decimal.Floor(total * c / weightSum)).ToArray();
        var remainder = total - targets.Sum();
        for (var i = 0; remainder > 0; i = (i + 1) % targets.Length)
            if (capacities[i] == 0 || targets[i] < capacities[i]) { targets[i]++; remainder--; }
        var cabinet = 0;
        // Consecutive allocation keeps the same SKU together instead of scattering it.
        foreach (var node in items.OrderBy(i => i?["product_code"]?.ToString(), StringComparer.Ordinal))
        {
            var item = node!.AsObject(); var original = (int)Read(item["pieces"]); var left = original;
            if (!string.IsNullOrWhiteSpace(item["packing_group"]?.ToString())) throw new InvalidOperationException("混装货物请先人工核对箱数，再安排分柜");
            var fits = Array.FindIndex(targets, target => target >= original);
            cabinet = fits >= 0 ? fits : Array.FindIndex(targets, target => target > 0);
            var allocated = new Dictionary<string, decimal>();
            while (left > 0)
            {
                if (cabinet >= targets.Length || targets[cabinet] == 0) cabinet = Array.FindIndex(targets, target => target > 0);
                var boxes = Math.Min(left, targets[cabinet]); var copy = item.DeepClone().AsObject();
                copy["pieces"] = boxes;
                copy["order_total_pieces"] = item["order_total_pieces"]?.DeepClone() ?? JsonValue.Create(orderTotals[OrderKey(item)]);
                foreach (var key in new[] { "quantity", "gross_weight", "net_weight", "net_net_weight", "volume", "measurement" })
                {
                    if (item[key] is null || item[key]!.ToString() == "") continue;
                    var amount = Read(item[key]); var previous = allocated.GetValueOrDefault(key);
                    var part = boxes == left ? amount - previous : decimal.Round(amount * boxes / original, MeasurementPrecision);
                    if (key == "quantity" && part != decimal.Truncate(part)) throw new InvalidOperationException("数量与箱数不匹配，请核对每箱个数");
                    copy[key] = part; allocated[key] = previous + part;
                }
                result[cabinet].Payload["items"]!.AsArray().Add(copy);
                left -= boxes; targets[cabinet] -= boxes;
            }
        }
        return result;
    }
}
