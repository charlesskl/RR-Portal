using System.Text.RegularExpressions;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public sealed record ProductInfoMatch(ProductInfo Product, string ChineseName, int QuantityPerBox);

public static class ProductInfoMatching
{
    public static string NormalizeCode(string? value) =>
        Regex.Replace((value ?? string.Empty).ToUpperInvariant(), "[^A-Z0-9]", string.Empty);

    public static string NormalizeEnglishName(string? value) =>
        Regex.Replace((value ?? string.Empty).ToUpperInvariant(), "[^A-Z0-9]", string.Empty);

    public static bool ContainsChinese(string? value) =>
        Regex.IsMatch(value ?? string.Empty, "[\\u4e00-\\u9fff]");

    public static bool ContainsLatin(string? value) =>
        Regex.IsMatch(value ?? string.Empty, "[A-Za-z]");

    public static ProductInfoMatch? FindExact(string? productCode, decimal? emailSpecification, IEnumerable<ProductInfo> products)
    {
        if (emailSpecification is null || emailSpecification <= 0 || emailSpecification != decimal.Truncate(emailSpecification.Value)) return null;
        var specification = decimal.ToInt32(emailSpecification.Value);
        var candidates = products.Where(value => NormalizeCode(value.ProductCode) == NormalizeCode(productCode)).ToList();
        var explicitMatches = candidates.Where(value => value.QuantityPerBox == specification).ToList();
        if (explicitMatches.Count == 1) return Create(explicitMatches[0], specification);
        if (explicitMatches.Count > 1) return null;
        var inferredMatches = candidates.Where(value => value.QuantityPerBox is null && InferSpecification(value.ProductName) == specification).ToList();
        return inferredMatches.Count == 1 ? Create(inferredMatches[0], specification) : null;
    }

    public static int? InferSpecification(string? productName)
    {
        var value = productName ?? string.Empty;
        var patterns = new[] {
            @"(?<value>\d+)\s*(?:个|PCS?)\s*/\s*(?:箱|CTN|展示架|邮包盒)",
            @"\*(?<value>\d+)\s*/\s*CTN", @"(?<value>\d+)\s*/\s*(?:箱|CTN)",
            @"(?<value>\d+)\s*个箱",
        };
        foreach (var pattern in patterns)
        {
            var match = Regex.Match(value, pattern, RegexOptions.IgnoreCase);
            if (match.Success && int.TryParse(match.Groups["value"].Value, out var result)) return result;
        }
        return null;
    }

    public static string CleanChineseName(string? productName)
    {
        var value = Regex.Replace(productName ?? string.Empty, @"[\r\n]+", " ").Trim();
        value = Regex.Replace(value,
            @"\s*\d+(?:\.\d+)?\s*(?:个|PCS?)?(?:胶袋)?\s*(?:/|每)\s*(?:箱|CTN|展示架|邮包盒).*$",
            string.Empty, RegexOptions.IgnoreCase).Trim();
        return value;
    }

    public static decimal TotalWeight(decimal pieces, decimal weightPerBox) =>
        decimal.Truncate(pieces * weightPerBox);

    private static ProductInfoMatch Create(ProductInfo product, int specification)
    {
        var chineseName = CleanChineseName(product.ProductName);
        return new ProductInfoMatch(product, chineseName, specification);
    }
}
