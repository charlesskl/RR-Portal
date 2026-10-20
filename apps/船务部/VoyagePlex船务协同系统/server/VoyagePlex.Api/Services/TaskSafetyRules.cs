using System.Globalization;
using System.Text.Json.Nodes;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class TaskSafetyRules
{
    public static object? OwnerWarning(ShipmentTask task, AppUser actor, JsonObject payload)
    {
        if (task.ResponsibleUserId <= 0 || task.ResponsibleUserId == actor.Id ||
            payload["confirmedOwnerId"]?.ToString() == task.ResponsibleUserId.ToString()) return null;
        return new { code = "OtherTaskOwner", error = $"此任务由【{task.ResponsibleUserName}】账号建立，继续操作将修改或删除其任务资料。是否继续？",
            taskId = task.Id, ownerId = task.ResponsibleUserId, ownerName = task.ResponsibleUserName };
    }

    private static bool PositiveWeight(JsonNode? value) =>
        decimal.TryParse(value?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var weight) && weight > 0;

    public static JsonArray MissingWeights(JsonObject payload)
    {
        var layout = payload["exportTemplate"]?["layoutKey"]?.ToString();
        if (layout == "SkyCastle" || (layout is null && payload["exportDetails"]?["templateKey"]?.ToString() == "sky-castle-multi")) return [];
        var missing = new JsonArray();
        var items = payload["items"] as JsonArray ?? [];
        for (var index = 0; index < items.Count; index++)
        {
            var item = items[index];
            var group = item?["packing_group"]?.ToString() ?? "";
            foreach (var (key, label, total) in new[] {
                ("gross_weight_per_box", "每箱毛重", "gross_weight"),
                (layout == "CartonMarks" ? "net_net_weight_per_box" : "net_weight_per_box", layout == "CartonMarks" ? "每箱净净重" : "每箱净重", "net_weight") })
            {
                if (PositiveWeight(item?[key])) continue;
                // Existing confirmed mixed groups may have reviewed total weights.
                if (group != "" && PositiveWeight(item?[total])) continue;
                if (group != "" && total == "gross_weight" && items.Take(index).Any(previous =>
                    previous?["packing_group"]?.ToString() == group && previous?["source_file"]?.ToString() == item?["source_file"]?.ToString())) continue;
                missing.Add(new JsonObject { ["itemIndex"] = index, ["productCode"] = item?["product_code"]?.ToString() ?? "", ["field"] = key, ["label"] = label, ["totalField"] = total });
            }
        }
        return missing;
    }
}

public sealed class TaskOwnerConfirmationException(object warning) : Exception("Task ownership confirmation required")
{
    public object Warning { get; } = warning;
}

public sealed class TaskWritebackConflictException() : Exception("任务有未解决的库存回写记录，请先处理回写恢复");
