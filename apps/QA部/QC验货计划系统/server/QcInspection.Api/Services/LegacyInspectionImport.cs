using System.Text.Json;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public static class LegacyInspectionImport
{
    public sealed record Entry(InspectionRecord Incoming, InspectionRecord? Current);
    private static string Normalize(string value) => value.Replace(" ", "").Trim().ToUpperInvariant();
    private static string Order(InspectionRecord row)
    {
        var key = string.Join('|', Normalize(row.ContractNumber), Normalize(row.CustomerPo), Normalize(row.ItemNumber));
        var template = row.Site == "华登" ? row.InspectionTemplate != "" ? row.InspectionTemplate : row.SourceSheet.Contains("DPI", StringComparison.OrdinalIgnoreCase) || row.SourceSheet.Contains("JAZ", StringComparison.OrdinalIgnoreCase) || row.ScheduleSource == "JAZ/JWC" || row.Customer.Contains("JAZ", StringComparison.OrdinalIgnoreCase) ? "JAZ专用" : "普通验货" : "";
        return template + "|" + (key == "||" ? $"未填单号|{Normalize(row.Customer)}|{Normalize(row.ProductName)}" : key);
    }
    private static string Values(InspectionRecord row) => JsonSerializer.Serialize(row.ImportFields.OrderBy(name => name)
        .ToDictionary(name => name, name => typeof(InspectionRecord).GetProperty(name)!.GetValue(row)));

    public static List<Entry> Plan(IEnumerable<InspectionRecord> incoming, IEnumerable<InspectionRecord> existing, string site, List<LegacyImportIssue>? issues = null)
    {
        var problems = issues ?? new List<LegacyImportIssue>();
        var rows = incoming.ToArray();
        var local = existing.Where(row => row.Site == site).ToArray();
        var byOrder = local.ToLookup(Order);
        var byContractItem = local.ToLookup(row => (Normalize(row.ContractNumber), Normalize(row.ItemNumber)));
        var result = new List<Entry>();
        var used = new HashSet<long>();
        foreach (var group in rows.GroupBy(row => (Order(row), row.InspectionDate?.Date, row.Quantity, row.Cartons)))
        {
            if (group.Select(Values).Distinct().Count() > 1)
            {
                var locations = string.Join("、", group.Select(row => $"{row.SourceSheet}第{row.SourceRow}行"));
                problems.AddRange(group.Select(row => LegacyImportIssue.From(row, $"同订单、日期、数量及箱数相同，但其他内容不同，与这些行冲突：{locations}；请核对重复行或拆分批次")));
                continue;
            }
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
            InspectionRecord? current = null;
            if (exactBatch.Length == 1) current = exactBatch[0];
            else if (exactBatch.Length > 1)
            {
                // Existing duplicate history does not block an unchanged Excel row.
                current = exactBatch.FirstOrDefault(value => IsSame(value, row));
                if (current is null) throw Conflict(row);
            }
            // Different dates, quantities or cartons are distinct inspections, even for the same order.
            if (current is not null && !used.Add(current.Id)) throw Conflict(row);
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

    private static InvalidDataException Conflict(InspectionRecord row) => new(
        "同厂区、订单、日期、数量和箱数匹配到多条记录，已保留旧记录并跳过此行，请对照系统记录核对");

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
        if (target.ScheduleKey == "") target.Fingerprint = Fingerprint(target);
        target.SourceFile = source.SourceFile;
        target.SourceSheet = source.SourceSheet;
        target.SourceRow = source.SourceRow;
        target.ImportedAt = DateTime.UtcNow;
    }
}
