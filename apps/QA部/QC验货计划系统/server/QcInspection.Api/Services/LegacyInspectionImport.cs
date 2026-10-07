using System.Text.Json;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public static class LegacyInspectionImport
{
    public sealed record Entry(InspectionRecord Incoming, InspectionRecord? Current);
    private static string Normalize(string value) => value.Replace(" ", "").Trim().ToUpperInvariant();
    private static string Order(InspectionRecord row) => string.Join('|', Normalize(row.ContractNumber), Normalize(row.CustomerPo), Normalize(row.ItemNumber));
    private static string Values(InspectionRecord row) => JsonSerializer.Serialize(row.ImportFields.OrderBy(name => name)
        .ToDictionary(name => name, name => typeof(InspectionRecord).GetProperty(name)!.GetValue(row)));

    public static List<Entry> Plan(IEnumerable<InspectionRecord> incoming, IEnumerable<InspectionRecord> existing, string site, List<LegacyImportIssue>? issues = null)
    {
        var problems = issues ?? new List<LegacyImportIssue>();
        var rows = incoming.ToArray();
        var local = existing.Where(row => row.Site == site).ToArray();
        var result = new List<Entry>();
        var used = new HashSet<long>();
        foreach (var group in rows.GroupBy(row => (Order(row), row.InspectionDate?.Date)))
        {
            if (group.Select(Values).Distinct().Count() > 1)
            {
                var locations = string.Join("、", group.Select(row => $"{row.SourceSheet}第{row.SourceRow}行"));
                problems.AddRange(group.Select(row => LegacyImportIssue.From(row, $"同订单同日期内容不同，与这些行冲突：{locations}；请核对重复行或拆分批次")));
                continue;
            }
            var row = group.First();
            try
            {
            var candidates = local.Where(value => Order(value) == Order(row)).ToArray();
            // A missing customer PO may be filled only when all other identity fields agree.
            if (candidates.Length == 0)
                candidates = local.Where(value => Normalize(value.ItemNumber) == Normalize(row.ItemNumber) &&
                    Normalize(value.ContractNumber) == Normalize(row.ContractNumber) &&
                    Normalize(row.ContractNumber) != "" &&
                    (Normalize(value.CustomerPo) == "" || Normalize(row.CustomerPo) == "")).ToArray();
            var dated = candidates.Where(value => value.InspectionDate?.Date == row.InspectionDate?.Date).ToArray();
            if (dated.Length > 1)
                dated = dated.Where(value => value.Quantity == row.Quantity).ToArray();
            InspectionRecord? current = null;
            if (dated.Length == 1) current = dated[0];
            else if (dated.Length > 1 || candidates.Any(value => value.InspectionDate?.Date == row.InspectionDate?.Date))
                throw Conflict(row);
            else if (candidates.Length > 0)
            {
                // A complete sheet listing old and new dates explicitly identifies separate batches.
                var oldDatesPresent = candidates.All(value => rows.Any(other => Order(other) == Order(row) &&
                    other.InspectionDate?.Date == value.InspectionDate?.Date));
                if (!oldDatesPresent)
                {
                    // Only a single unfinished plan can be rescheduled without mistaking history for a new batch.
                    var finalResults = new[] { "PASS", "HOLD", "REJ", "AOD", "LG", "AOD+LG", "不用验", "待复检" };
                    if (candidates.Length != 1 || candidates[0].Quantity != row.Quantity ||
                        finalResults.Contains(candidates[0].InternalResult.Trim().ToUpperInvariant()) ||
                        finalResults.Contains(candidates[0].ThirdPartyResult.Trim().ToUpperInvariant())) throw Conflict(row);
                    current = candidates[0];
                }
            }
            if (current is not null && !used.Add(current.Id)) throw Conflict(row);
            var quantity = row.ImportFields.Contains(nameof(row.Quantity)) ? row.Quantity : current?.Quantity;
            var inspected = row.ImportFields.Contains(nameof(row.InspectedQuantity)) ? row.InspectedQuantity : current?.InspectedQuantity;
            if (inspected > quantity)
                throw new InvalidDataException("导入后实际验货数量超过计划数量");
            result.Add(new(row, current));
            }
            catch (InvalidDataException error)
            {
                problems.AddRange(group.Select(value => LegacyImportIssue.From(value, error.Message)));
            }
        }
        if (issues is null && problems.Count > 0)
            throw new InvalidDataException(string.Join("；", problems.Select(problem => $"{problem.Sheet} 第{problem.Row}行：{problem.Reason}")));
        return result;
    }

    private static InvalidDataException Conflict(InspectionRecord row) => new(
        "日期或批次匹配不明确，请在表中保留原批次记录并核对日期，不会自动合并");

    public static void Apply(InspectionRecord target, InspectionRecord source)
    {
        foreach (var field in source.ImportFields)
        {
            var property = typeof(InspectionRecord).GetProperty(field)!;
            property.SetValue(target, property.GetValue(source));
        }
        if (target.ScheduleKey == "")
        {
            var identity = string.Join('|', target.Site, target.InspectionDate?.ToString("yyyy-MM-dd"),
                target.ContractNumber, target.CustomerPo, target.ItemNumber, target.Quantity, target.Cartons);
            target.Fingerprint = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(identity)));
        }
        target.SourceFile = source.SourceFile;
        target.SourceSheet = source.SourceSheet;
        target.SourceRow = source.SourceRow;
        target.ImportedAt = DateTime.UtcNow;
    }
}
