using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ShipmentOrderTotals
{
    public static void Apply(JsonObject targetPayload, IEnumerable<ShipmentTask> tasks)
    {
        var totals = new Dictionary<string, decimal>(StringComparer.Ordinal);
        var seenRows = new HashSet<string>(StringComparer.Ordinal);

        foreach (var task in tasks)
        {
            if (string.Equals(task.Status, "Cancelled", StringComparison.OrdinalIgnoreCase)) continue;
            var items = JsonNode.Parse(string.IsNullOrWhiteSpace(task.ItemsJson) ? "[]" : task.ItemsJson)?.AsArray() ?? [];
            var itemIndex = 0;
            foreach (var node in items)
            {
                itemIndex++;
                if (node is not JsonObject item || !TryKey(task.Customer, item, out var key)) continue;
                var pieces = DecimalValue(item["pieces"]);
                if (pieces is null) continue;

                // 同一份 Packing List 可能同时附在整柜和拼柜邮件中；有来源行时按文件和行去重。
                var sourceFile = Normalize(item["source_file"]?.ToString());
                var sourceRow = Normalize(item["source_row"]?.ToString());
                var signature = sourceFile.Length > 0 && sourceRow.Length > 0
                    ? $"{key}|{sourceFile}|{sourceRow}|{pieces.Value.ToString(CultureInfo.InvariantCulture)}"
                    : $"{key}|TASK:{task.Id}|ROW:{itemIndex}";
                if (!seenRows.Add(signature)) continue;
                totals[key] = totals.GetValueOrDefault(key) + pieces.Value;
            }
        }

        var targetCustomer = targetPayload["customer"]?.ToString() ?? string.Empty;
        foreach (var node in targetPayload["items"]?.AsArray() ?? [])
        {
            if (node is not JsonObject item) continue;
            item["order_total_pieces"] = TryKey(targetCustomer, item, out var key) && totals.TryGetValue(key, out var total)
                ? JsonValue.Create(total)
                : item["pieces"]?.DeepClone();
        }
    }

    private static bool TryKey(string customer, JsonObject item, out string key)
    {
        var contract = Normalize(Value(item, "contract_number", "contractNumber"));
        var customerPo = Normalize(Value(item, "customer_po", "customerPo"));
        var productCode = BaseProductCode(Value(item, "product_code", "productCode"));
        var customerKey = Normalize(customer);
        if (customerKey.Length == 0 || contract.Length == 0 || customerPo.Length == 0 || productCode.Length == 0)
        {
            key = string.Empty;
            return false;
        }
        key = $"{customerKey}|{contract}|{customerPo}|{productCode}";
        return true;
    }

    private static string Value(JsonObject item, string first, string second) =>
        item[first]?.ToString() ?? item[second]?.ToString() ?? string.Empty;

    private static string BaseProductCode(string value) =>
        Regex.Match(value.Trim(), @"^\d+").Value;

    private static string Normalize(string? value) =>
        Regex.Replace((value ?? string.Empty).ToUpperInvariant(), @"[^A-Z0-9]", string.Empty);

    private static decimal? DecimalValue(JsonNode? node) =>
        decimal.TryParse(node?.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : null;
}
