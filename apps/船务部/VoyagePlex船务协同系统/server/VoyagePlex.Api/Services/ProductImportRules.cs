using System.Text.RegularExpressions;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public sealed record ProductImportSelection(List<ProductInfo> Items, string[] SkippedCodes, int SkippedRows, int SupersededRows);

public static class ProductImportRules
{
    public static ProductImportSelection SelectLatest(IEnumerable<ProductInfo> source)
    {
        var rows = source.ToList();
        var skippedCodes = rows.GroupBy(value => NormalizeCode(value.ProductCode), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Select(value => value.Customer.Trim()).Where(value => value != "").Distinct(StringComparer.OrdinalIgnoreCase).Count() >= 2)
            .Select(group => group.Key).OrderBy(value => value).ToArray();
        var skipped = skippedCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var skippedRows = rows.Count(value => skipped.Contains(NormalizeCode(value.ProductCode)));
        var eligible = rows.Where(value => !skipped.Contains(NormalizeCode(value.ProductCode))).ToList();
        var selected = eligible.GroupBy(value => (Code: NormalizeCode(value.ProductCode), value.QuantityPerBox))
            .Select(group => group.OrderByDescending(value => value.LegacyId).First()).ToList();
        return new(selected, skippedCodes, skippedRows, eligible.Count - selected.Count);
    }

    private static string NormalizeCode(string value) => Regex.Replace(value.Trim().ToUpperInvariant(), @"\s+", "");
}
