using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class MailClassificationRules
{
    private static readonly string[] ChangeKeywords =
        ["更新", "修改", "变更", "延迟", "延期", "改期", "截补", "update", "updated", "revised", "revision", "delay"];
    private static readonly string[] ShipmentKeywords =
        ["出货通知", "交仓", "整柜", "订舱", "入仓", "装箱", "散货", "预计提货", "走货", "装柜", "提货", "shipment", "shipping", "air ship", "booking", "load#", "so#", "poe"];

    private const int ParsedShipmentConfidence = 90;
    private const int ParsedChangeConfidence = 92;

    public static (string Category, int Confidence, string Source, bool NeedsReview, string Mode) ClassifyParsed(string subject, JsonObject parsed)
    {
        var fields = parsed["fields"] as JsonObject;
        var body = parsed["message"]?["body_text"]?.ToString() ?? "";
        // 转发引用中的旧指令不能把本次回执或普通邮件误判为新任务。
        var currentBody = Regex.Split(body, @"(?im)^\s*(?:-{2,}\s*(?:Original Message|原始邮件)|On .+wrote:|发件人[:：]|From:)")[0];
        var text = $"{subject}\n{currentBody}";
        var category = Classify(subject);
        var hasCargo = (parsed["items"] as JsonArray)?.Count > 0;
        var hasSo = (parsed["so_numbers"] as JsonArray)?.Count > 0 || !string.IsNullOrWhiteSpace(fields?["so_number"]?.ToString());
        var change = ChangeKeywords.Any(keyword => currentBody.Contains(keyword, StringComparison.OrdinalIgnoreCase));
        if (category.Category == "Unclassified" && change && (hasSo || hasCargo))
            category = ("Change", ParsedChangeConfidence, "ParsedRule", false);
        if (category.Category == "Unclassified" && hasCargo)
            category = ("Shipment", ParsedShipmentConfidence, "ParsedRule", false);
        if (category.Category == "Unclassified" && Regex.IsMatch(text, @"船期资讯|收件回执|已收到.{0,10}谢谢|仅供参考"))
            category = ("Other", ParsedShipmentConfidence, "ParsedRule", false);
        var warehouse = Regex.IsMatch(text, @"交仓|入仓|散货收货站|\bCFS\b", RegexOptions.IgnoreCase);
        var container = Regex.IsMatch(text + "\n" + fields?["container_type"], @"整柜|装柜|\b(?:20|40|45)\s*(?:HQ|HC|GP|FT)\b", RegexOptions.IgnoreCase);
        var mode = warehouse ? "Warehouse" : container ? "Container" : "Unknown";
        return (category.Category, category.Confidence, "ParsedRule", category.NeedsReview, mode);
    }

    public static (string Category, int Confidence, string Source, bool NeedsReview, string Mode) ClassifyStored(string subject, string json)
    {
        try { return ClassifyParsed(subject, DailyMailRules.Parse(json)); }
        catch (InvalidOperationException) { return ("Unclassified", 0, "ParsedRule", true, "Unknown"); }
    }

    public static string NormalizeEmail(string sender)
    {
        var match = Regex.Match(sender ?? "", @"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase);
        return match.Success ? match.Value.ToLowerInvariant() : (sender ?? "").Trim().ToLowerInvariant();
    }

    public static (string Category, int Confidence, string Source, bool NeedsReview) Classify(string subject)
    {
        var normalized = (subject ?? "").ToLowerInvariant();
        if (ChangeKeywords.Any(normalized.Contains)) return ("Change", 92, "SubjectRule", false);
        if (ShipmentKeywords.Any(normalized.Contains)) return ("Shipment", 90, "SubjectRule", false);
        return ("Unclassified", 0, "Automatic", true);
    }
}
