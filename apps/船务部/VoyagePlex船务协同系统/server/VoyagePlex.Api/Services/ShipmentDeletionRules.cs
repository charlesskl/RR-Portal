using System.Text.Json.Nodes;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ShipmentDeletionRules
{
    public static bool IsRelatedImport(ShipmentTask task, ImportEmailItem item, string sourceFingerprint)
    {
        if (task.SourceImportItemId.HasValue &&
            (item.Id == task.SourceImportItemId.Value || item.DuplicateOfItemId == task.SourceImportItemId.Value)) return true;
        if (!string.IsNullOrWhiteSpace(sourceFingerprint) && item.Fingerprint == sourceFingerprint) return true;
        if (string.IsNullOrWhiteSpace(task.SoNumber)) return false;
        try
        {
            var parsed = JsonNode.Parse(item.ResultJson)?.AsObject();
            var fields = parsed?["fields"]?.AsObject();
            var soNumber = fields?["so_number"]?.ToString();
            if (string.IsNullOrWhiteSpace(soNumber))
                soNumber = string.Join(", ", parsed?["so_numbers"]?.AsArray().Select(value => value?.ToString()).Where(value => !string.IsNullOrWhiteSpace(value)) ?? []);
            return string.Equals(NormalizeSo(soNumber), NormalizeSo(task.SoNumber), StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static string NormalizeSo(string? value) => string.Concat((value ?? string.Empty).Where(char.IsLetterOrDigit));
}
