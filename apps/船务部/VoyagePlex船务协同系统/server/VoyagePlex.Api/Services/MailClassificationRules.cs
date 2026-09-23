using System.Text.RegularExpressions;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class MailClassificationRules
{
    private static readonly string[] ChangeKeywords =
        ["更新", "修改", "变更", "延迟", "延期", "改期", "截补", "update", "updated", "revised", "revision", "delay"];
    private static readonly string[] ShipmentKeywords =
        ["出货通知", "预计提货", "走货", "装柜", "提货", "shipment", "shipping", "air ship", "booking", "load#", "so#", "poe"];

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
