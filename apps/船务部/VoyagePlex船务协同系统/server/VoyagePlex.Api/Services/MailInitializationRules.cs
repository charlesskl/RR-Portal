using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace VoyagePlex.Api.Services;

public static class MailInitializationRules
{
    public static string? SafeSo(string resultJson, DateOnly todayInChina)
    {
        JsonObject? parsed;
        try { parsed = JsonNode.Parse(resultJson)?.AsObject(); }
        catch (Exception error) when (error is JsonException or InvalidOperationException) { return null; }
        if (parsed is null) return null;
        var soNumbers = parsed["so_numbers"] as JsonArray;
        if (soNumbers?.Count != 1) return null;
        var so = soNumbers[0]?.ToString().Trim() ?? "";
        var shipDate = (parsed["fields"] as JsonObject)?["ship_date"]?.ToString() ?? "";
        if (so == "" || !DateOnly.TryParseExact(shipDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var plannedDate) || plannedDate < todayInChina) return null;
        return so;
    }
}
