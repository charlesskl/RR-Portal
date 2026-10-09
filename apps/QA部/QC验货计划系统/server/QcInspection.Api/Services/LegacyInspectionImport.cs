using System.Text.Json;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public static class LegacyInspectionImport
{
    public sealed record Entry(InspectionRecord Incoming, InspectionRecord? Current);
    public static bool IsRejected(InspectionRecord row) => row.InternalResult.Trim().Equals("REJ", StringComparison.OrdinalIgnoreCase) || row.ThirdPartyResult.Trim().Equals("REJ", StringComparison.OrdinalIgnoreCase);
    private static string Normalize(string value) => value.Replace(" ", "").Trim().ToUpperInvariant();
    private static string Order(InspectionRecord row)
    {
        var key = string.Join('|', Normalize(row.ContractNumber), Normalize(row.CustomerPo), Normalize(row.ItemNumber));
        var template = row.Site == "华登" ? "普通验货" : "";
        return template + "|" + (key == "||" ? $"未填单号|{Normalize(row.Customer)}|{Normalize(row.ProductName)}" : key);
    }
    private static string Values(InspectionRecord row) => JsonSerializer.Serialize(row.ImportFields.OrderBy(name => name)
        .ToDictionary(name => name, name => typeof(InspectionRecord).GetProperty(name)!.GetValue(row)));

    public static List<Entry> Plan(IEnumerable<InspectionRecord> incoming, IEnumerable<InspectionRecord> existing, string site, List<LegacyImportIssue>? issues = null)
    {
        var problems = issues ?? new List<LegacyImportIssue>();
        var rows = incoming.ToArray();
        var local = existing.Where(row => row.Site == site && (site != "华登" || !row.SourceSheet.Contains("DPI", StringComparison.OrdinalIgnoreCase))).ToArray();
        var byOrder = local.ToLookup(Order);
        var byContractItem = local.ToLookup(row => (Normalize(row.ContractNumber), Normalize(row.ItemNumber)));
        var result = new List<Entry>();
        var used = new HashSet<long>();
        var batches = rows.GroupBy(row => (Order(row), row.InspectionDate?.Date, row.Quantity, row.Cartons)).ToArray();
        foreach (var batch in batches)
        foreach (var group in batch.GroupBy(Values))
        {
            var separateRows = batch.Select(Values).Distinct().Count() > 1;
            var row = group.First();
            InspectionRecord[] candidates = [];
            try
            {
            candidates = byOrder[Order(row)].ToArray();
            // A missing customer PO may be filled only when all other identity fields agree.
            if (candidates.Length == 0)
                candidates = byContractItem[(Normalize(row.ContractNumber), Normalize(row.ItemNumber))]
                    .Where(value => Normalize(row.ContractNumber) != "" &&
                        (Normalize(value.CustomerPo) == "" || Normalize(row.CustomerPo) == "") &&
                        Order(value).Split('|')[0] == Order(row).Split('|')[0]).ToArray();
            var dated = candidates.Where(value => value.InspectionDate?.Date == row.InspectionDate?.Date).ToArray();
            var exactBatch = dated.Where(value => (!row.ImportFields.Contains(nameof(row.Quantity)) || value.Quantity == row.Quantity) &&
                (!row.ImportFields.Contains(nameof(row.Cartons)) || value.Cartons == row.Cartons)).ToArray();
            // Different Excel rows are distinct inspections. Match unchanged data before considering updates.
            var current = exactBatch.FirstOrDefault(value => !used.Contains(value.Id) && IsSame(value, row));
            if (current is null && !separateRows)
            {
                var editable = exactBatch.Where(value => !IsRejected(value) && !used.Contains(value.Id) && SameInspectionLane(value, row) &&
                    (!IsRejected(row) || value.InternalResult == "" && value.ThirdPartyResult == "")).ToArray();
                if (editable.Length == 1) current = editable[0];
                else if (editable.Length > 1)
                {
                    // Source position can identify an edited row in the same workbook. Otherwise preserve history and add.
                    var located = editable.Where(value => value.SourceFile == row.SourceFile && value.SourceSheet == row.SourceSheet && value.SourceRow == row.SourceRow).ToArray();
                    if (located.Length == 1) current = located[0];
                }
            }
            if (current is not null) used.Add(current.Id);
            var quantity = row.ImportFields.Contains(nameof(row.Quantity)) ? row.Quantity : current?.Quantity;
            var inspected = row.ImportFields.Contains(nameof(row.InspectedQuantity)) ? row.InspectedQuantity : current?.InspectedQuantity;
            if (inspected > quantity)
                throw new InvalidDataException("导入后实际验货数量超过计划数量");
            result.Add(new(row, current));
            }
            catch (InvalidDataException error)
            {
                problems.AddRange(group.Select(value => LegacyImportIssue.From(value, error.Message, candidates)));
            }
        }
        if (issues is null && problems.Count > 0)
            throw new InvalidDataException(string.Join("；", problems.Select(problem => $"{problem.Sheet} 第{problem.Row}行：{problem.Reason}")));
        return result;
    }

    private static bool SameInspectionLane(InspectionRecord current, InspectionRecord incoming)
    {
        foreach (var field in new[] { nameof(incoming.Customer), nameof(incoming.ThirdPartyOrganization) })
        {
            if (!incoming.ImportFields.Contains(field)) continue;
            var property = typeof(InspectionRecord).GetProperty(field)!;
            if (Normalize((string)property.GetValue(current)!) != Normalize((string)property.GetValue(incoming)!)) return false;
        }
        static bool HasResult(string value) => Normalize(value) is not ("" or "NA" or "N/A" or "/" or "不用验");
        var currentHasResult = HasResult(current.InternalResult) || HasResult(current.ThirdPartyResult);
        var incomingHasResult = HasResult(incoming.InternalResult) || HasResult(incoming.ThirdPartyResult);
        return !currentHasResult || !incomingHasResult ||
            ((!incoming.ImportFields.Contains(nameof(incoming.InternalResult)) || HasResult(current.InternalResult) == HasResult(incoming.InternalResult)) &&
             (!incoming.ImportFields.Contains(nameof(incoming.ThirdPartyResult)) || HasResult(current.ThirdPartyResult) == HasResult(incoming.ThirdPartyResult)));
    }

    public static string Fingerprint(InspectionRecord row)
    {
        var identity = string.Join('|', row.Site, Order(row), row.InspectionDate?.ToString("yyyy-MM-dd"),
            row.Quantity?.ToString(System.Globalization.CultureInfo.InvariantCulture),
            row.Cartons?.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(identity)));
    }

    public static bool IsSame(InspectionRecord current, InspectionRecord incoming) => incoming.ImportFields.All(field =>
        Equals(typeof(InspectionRecord).GetProperty(field)!.GetValue(current), typeof(InspectionRecord).GetProperty(field)!.GetValue(incoming)));

    public static void Apply(InspectionRecord target, InspectionRecord source)
    {
        foreach (var field in source.ImportFields)
        {
            var property = typeof(InspectionRecord).GetProperty(field)!;
            property.SetValue(target, property.GetValue(source));
        }
        // Keep persisted identity stable when adding a separate reinspection to the same batch.
        target.SourceFile = source.SourceFile;
        target.SourceSheet = source.SourceSheet;
        target.SourceRow = source.SourceRow;
        target.ImportedAt = DateTime.UtcNow;
    }
}
