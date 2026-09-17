using System.Text.Json.Nodes;

namespace VoyagePlex.Api.Services;

public static class ShipmentImportMerge
{
    public static JsonArray AppendNewItems(JsonArray existing, JsonArray incoming, JsonArray? previousImport = null)
    {
        var result = JsonNode.Parse(existing.ToJsonString())!.AsArray();
        var remaining = new Dictionary<string, int>(StringComparer.Ordinal);
        var previousCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var item in previousImport ?? new JsonArray())
        {
            var key = ItemKey(item);
            previousCounts[key] = previousCounts.GetValueOrDefault(key) + 1;
        }
        foreach (var item in existing)
        {
            var key = ItemKey(item);
            remaining[key] = remaining.GetValueOrDefault(key) + 1;
        }
        foreach (var (key, count) in previousCounts)
            remaining[key] = Math.Max(remaining.GetValueOrDefault(key), count);
        foreach (var item in incoming)
        {
            if (item is null) continue;
            var key = ItemKey(item);
            if (remaining.GetValueOrDefault(key) > 0)
            {
                remaining[key]--;
                continue;
            }
            result.Add(item.DeepClone());
        }
        return result;
    }

    public static JsonArray AppendNewGroups(JsonArray existing, JsonArray incoming, JsonArray? previousImport = null)
    {
        var result = JsonNode.Parse(existing.ToJsonString())!.AsArray();
        foreach (var node in incoming)
        {
            if (node is not JsonObject group) continue;
            var key = GroupKey(group);
            var previous = (previousImport ?? new JsonArray()).OfType<JsonObject>()
                .FirstOrDefault(value => GroupKey(value) == key);
            var current = result.OfType<JsonObject>().FirstOrDefault(value => GroupKey(value) == key);
            if (current is null)
            {
                if (previous is null) result.Add(group.DeepClone());
                continue;
            }
            current["items"] = AppendNewItems(
                current["items"]?.AsArray() ?? new JsonArray(),
                group["items"]?.AsArray() ?? new JsonArray(),
                previous?["items"]?.AsArray());
        }
        return result;
    }

    private static string GroupKey(JsonObject group)
    {
        var references = group["references"]?.AsArray().Select(value => value?.ToString() ?? "").ToArray() ?? [];
        var files = group["source_files"]?.AsArray().Select(value => value?.ToString() ?? "") ?? [];
        var stableSource = references.Length > 0 ? references : files;
        return string.Join("\u001f", stableSource) + "\u001e" + (group["container_type"]?.ToString() ?? "");
    }

    private static string ItemKey(JsonNode? node)
    {
        if (node is not JsonObject item) return node?.ToJsonString() ?? "";
        var file = item["source_file"]?.ToString() ?? "";
        var row = item["source_row"]?.ToString() ?? "";
        if (row.Length > 0)
            return $"source\u001e{file}\u001f{row}\u001f{item["container_assignment"]}\u001f{(file.Length == 0 ? item["product_code"] : "")}";
        return "item\u001e" + string.Join("\u001f", new[] {
            file,
            item["product_code"]?.ToString() ?? "",
            item["contract_number"]?.ToString() ?? "",
            item["customer_po"]?.ToString() ?? "",
            item["supplier"]?.ToString() ?? "",
            item["container_assignment"]?.ToString() ?? "",
        });
    }
}
