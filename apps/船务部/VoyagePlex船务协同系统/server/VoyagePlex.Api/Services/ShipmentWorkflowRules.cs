using System.Text.RegularExpressions;

namespace VoyagePlex.Api.Services;

public static class ShipmentWorkflowRules
{
    // Confirmed business rule: inventory/inspection are visible readiness states,
    // but they do not block task creation or worksheet generation.
    public static bool CanCreateTask(bool emailReviewed) => emailReviewed;
    public static bool CanGenerateWorksheet(bool taskExists) => taskExists;
    public static bool CanEnterPendingShipment(DateOnly? plannedShipDate) => plannedShipDate.HasValue;

    public static DateOnly? ResolvePlannedShipDate(string shipDate, string cutoffDate, string siDeadline, string? receivedAt)
    {
        var year = DateTime.Today.Year;
        if (DateTimeOffset.TryParse(receivedAt, out var received)) year = received.Year;

        static DateOnly? ParseDate(string value, int fallbackYear)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var full = Regex.Match(value, @"(?<y>20\d{2})[/.-](?<m>\d{1,2})[/.-](?<d>\d{1,2})");
            if (full.Success) return new DateOnly(int.Parse(full.Groups["y"].Value), int.Parse(full.Groups["m"].Value), int.Parse(full.Groups["d"].Value));
            var named = Regex.Match(value, @"(?<d>\d{1,2})[-\s](?<m>[A-Za-z]{3})[-\s](?<y>20\d{2})", RegexOptions.IgnoreCase);
            if (named.Success)
            {
                var month = named.Groups["m"].Value.ToUpperInvariant() switch
                {
                    "JAN" => 1, "FEB" => 2, "MAR" => 3, "APR" => 4,
                    "MAY" => 5, "JUN" => 6, "JUL" => 7, "AUG" => 8,
                    "SEP" => 9, "OCT" => 10, "NOV" => 11, "DEC" => 12,
                    _ => 0,
                };
                if (month > 0) return new DateOnly(int.Parse(named.Groups["y"].Value), month, int.Parse(named.Groups["d"].Value));
            }
            var shortDate = Regex.Match(value, @"(?<m>\d{1,2})[/月.-](?<d>\d{1,2})");
            return shortDate.Success
                ? new DateOnly(fallbackYear, int.Parse(shortDate.Groups["m"].Value), int.Parse(shortDate.Groups["d"].Value))
                : null;
        }

        var explicitShipDate = ParseDate(shipDate, year);
        if (explicitShipDate.HasValue) return explicitShipDate;
        var deadline = ParseDate(string.IsNullOrWhiteSpace(cutoffDate) ? siDeadline : cutoffDate, year);
        return deadline?.AddDays(-1);
    }

    public static bool CanTransitionStatus(string currentStatus, string nextStatus) =>
        (currentStatus, nextStatus) switch
        {
            ("PendingReview", "PendingShipment") => true,
            ("PendingReview", "Cancelled") => true,
            ("PendingShipment", "Completed") => true,
            ("PendingShipment", "Cancelled") => true,
            _ => false,
        };

    public static string[] ReadinessWarnings(bool inventoryConfirmed, bool inspectionConfirmed)
    {
        var warnings = new List<string>();
        if (!inventoryConfirmed) warnings.Add("库存未确认");
        if (!inspectionConfirmed) warnings.Add("验货未确认");
        return [.. warnings];
    }
}
