using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Text;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class DailyMailRules
{
    // 本次切换采用固定北京时间日期，不能随服务重启滚动到新的“明天”。
    public const string StartDate = "2026-10-08";
    public const int WorkflowVersion = 1;

    public static JsonObject Parse(string json)
    {
        try { return JsonNode.Parse(json)?.AsObject() ?? new JsonObject(); }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        { throw new InvalidOperationException("邮件解析资料无效，请重新读取或标记无需建任务", error); }
    }

    public static bool CanCreateTask(ImportEmailItem item)
        => item.HandlingStatus == "Pending" && item.Status is "pending" &&
            !item.NeedsClassificationReview && item.WorkCategory is "Shipment" or "Change";

    // A review token is an optimistic concurrency check, never an authorization token.
    // Include the parsed document so a late save/reparse cannot be restored from a stale preview.
    public static string ReviewVersion(ImportEmailItem item) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            item.Id, item.Company, item.MailOwnerId, item.ImportBatchId, item.MailboxKey,
            item.FileName, item.MailSubject, item.MailSender, item.MailReceivedAt, item.MailReceivedDate,
            item.Fingerprint, item.BusinessFingerprint, item.DuplicateOfItemId, item.Status,
            item.HandlingStatus, item.HandlingOutcome, item.TaskIdsJson, item.WorkCategory,
            item.ClassificationSource, item.ClassificationConfidence, item.NeedsClassificationReview,
            item.ShipmentMode, item.ResultJson, item.WorkNote, item.Error,
            ReviewedAtTicks = item.ReviewedAt?.Ticks, CreatedAtTicks = item.CreatedAt.Ticks,
        })))).ToLowerInvariant();

    public static long[] RecordedTaskIds(ImportEmailItem item)
    {
        try
        {
            var ids = JsonSerializer.Deserialize<long[]>(item.TaskIdsJson);
            if (ids is null || ids.Any(id => id <= 0) || ids.Distinct().Count() != ids.Length)
                throw new InvalidOperationException("邮件任务关联资料无效，请联系管理员核对");
            return ids;
        }
        catch (JsonException error)
        { throw new InvalidOperationException("邮件任务关联资料无效，请联系管理员核对", error); }
    }

    public static bool CanRestoreTaskReview(ImportEmailItem item)
    {
        if (item.MailboxKey == "" || item.HandlingStatus != "Processed" || item.HandlingOutcome != "NoTask" ||
            item.Status != "pending" || item.NeedsClassificationReview || item.WorkCategory is not ("Shipment" or "Change"))
            return false;
        try { return RecordedTaskIds(item).Length == 0; }
        catch (InvalidOperationException) { return false; }
    }

    public static void ApplyConfirmedChanges(ShipmentTask task, JsonObject parsed)
    {
        var fields = parsed["fields"] as JsonObject ?? new JsonObject();
        string Value(string key) => fields[key]?.ToString().Trim() ?? "";
        // 已确认变更只写入明确提供的字段；缺失值不能清掉任务中已核对的资料。
        if (Value("container_type") is { Length: > 0 } container) task.ContainerType = container;
        if (Value("cutoff_date") is { Length: > 0 } cutoff) task.CutoffDate = cutoff;
        if (Value("si_deadline") is { Length: > 0 } si) task.SiDeadline = si;
        if (Value("port") is { Length: > 0 } port) task.Port = port;
        if (Value("destination_country") is { Length: > 0 } country) task.DestinationCountry = country;
        if (Value("special_requirements") is { Length: > 0 } special) task.SpecialRequirements = special;
        if (Value("ship_date") is { Length: > 0 } date)
        {
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var shipDate))
                throw new InvalidOperationException("变更邮件的走货日期无效，请核对为 yyyy-MM-dd 后确认");
            task.PlannedShipDate = shipDate;
        }
        task.UpdatedAt = DateTime.UtcNow;
    }

    public static void RecordSource(ShipmentTask task, ImportEmailItem item, bool created)
    {
        if (item.Status is not ("confirmed" or "duplicate_confirmed"))
            throw new InvalidOperationException("未确认邮件不能写入任务来源");
        var sources = JsonNode.Parse(task.SourceEmailsJson)?.AsArray() ?? new JsonArray();
        if (sources.OfType<JsonObject>().Any(source => source["id"]?.GetValue<long>() == item.Id)) return;
        sources.Add(new JsonObject
        {
            ["id"] = item.Id, ["isMailbox"] = item.MailboxKey != "", ["mailSubject"] = item.MailSubject.Length > 0 ? item.MailSubject : item.FileName,
            ["mailSender"] = item.MailSender, ["mailReceivedAt"] = item.MailReceivedAt,
            ["workCategory"] = item.WorkCategory, ["relation"] = created ? "创建来源" : "确认补充或变更",
        });
        task.SourceEmailsJson = sources.ToJsonString();
    }
}
