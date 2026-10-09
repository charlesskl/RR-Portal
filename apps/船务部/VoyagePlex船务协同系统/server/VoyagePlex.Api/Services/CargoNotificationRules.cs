using System.Text.Json.Nodes;

namespace VoyagePlex.Api.Services;

public static class CargoNotificationRules
{
    public static string? Validate(JsonObject payload)
    {
        if (payload["fields"]?["cargo_split_required"]?.ToString() != "true") return null;
        var items = payload["items"]?.AsArray() ?? new JsonArray();
        return items.Count == 0 || items.Any(item => item?["shipment_scope"]?.ToString() is not ("current" or "waiting"))
            ? "邮件包含等待通知的剩余货物，请先逐行分配本次出运或等待客户通知，再确认" : null;
    }

    public static List<(string GroupKey, JsonObject Payload)> Split(string groupKey, JsonObject payload)
    {
        if (payload["fields"]?["cargo_split_required"]?.ToString() != "true") return [(groupKey, payload)];
        var cargo = payload["items"]?.AsArray() ?? new JsonArray();
        if (cargo.Any(item => item?["shipment_scope"]?.ToString() is not ("current" or "waiting")))
            throw new InvalidOperationException("邮件包含等待通知的剩余货物，请先逐行分配本次出运或等待客户通知，再确认");
        var result = new List<(string, JsonObject)>();
        foreach (var scope in new[] { "current", "waiting" })
        {
            var items = cargo.Where(item => item?["shipment_scope"]?.ToString() == scope).ToArray();
            if (items.Length == 0) continue;
            var split = payload.DeepClone().AsObject();
            split["items"] = new JsonArray(items.Select(item => item!.DeepClone()).ToArray());
            var warehouses = new JsonArray();
            foreach (var group in payload["warehouse_groups"]?.AsArray().OfType<JsonObject>() ?? [])
            {
                var selected = group["items"]?.AsArray().Where(item => items.Any(cargoItem => SameSource(cargoItem, item))).ToArray() ?? [];
                if (selected.Length == 0) continue;
                var clone = group.DeepClone().AsObject();
                clone["items"] = new JsonArray(selected.Select(item => item!.DeepClone()).ToArray());
                warehouses.Add(clone);
            }
            split["warehouse_groups"] = warehouses;
            if (scope == "waiting")
            {
                var fields = split["fields"]!.AsObject();
                fields["ship_date"] = "";
                fields["container_type"] = "散货交仓";
                fields["waiting_notification"] = "true";
                if (split["message"] is JsonObject message) message["subject"] = $"{message["subject"]} · 剩余散货等待客户通知";
            }
            result.Add((scope == "waiting" ? $"{groupKey}:waiting-notification" : groupKey, split));
        }
        return result;
    }

    private static bool SameSource(JsonNode? left, JsonNode? right) =>
        left?["source_file"]?.ToString() == right?["source_file"]?.ToString() &&
        left?["source_row"]?.ToString() == right?["source_row"]?.ToString() &&
        left?["product_code"]?.ToString() == right?["product_code"]?.ToString() &&
        left?["customer_po"]?.ToString() == right?["customer_po"]?.ToString() &&
        left?["contract_number"]?.ToString() == right?["contract_number"]?.ToString();
}
