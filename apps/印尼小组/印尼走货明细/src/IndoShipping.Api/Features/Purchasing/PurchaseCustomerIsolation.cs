using System.Text.RegularExpressions;

namespace IndoShipping.Api.Features.Purchasing;

// Customer is not encoded in IRRI/HSY numbers. Resolve every source product,
// including compound Spin SKUs, before allowing a manual order merge.
public static class PurchaseCustomerIsolation
{
    public sealed record Product(string Code, string? Customer);
    public sealed record Schedule(string Code, string OrderNo, string? Customer);

    public static string Normalize(string? value)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0 || text.Equals("TOMY", StringComparison.OrdinalIgnoreCase)) return "TOMY";
        return Regex.IsMatch(text, @"^spin\s*(master)?$", RegexOptions.IgnoreCase) ? "Spin Master" : text;
    }

    public static IReadOnlyList<string> Codes(string? value, IEnumerable<string> knownCodes)
    {
        var known = knownCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var parts = (value ?? "").Split('/').Select(p => p.Trim()).Where(p => p.Length > 0).ToArray();
        var result = new List<string>();
        for (var start = 0; start < parts.Length;)
        {
            var end = parts.Length;
            while (end > start + 1 && !known.Contains(string.Join("/", parts[start..end]))) end--;
            result.Add(string.Join("/", parts[start..end]));
            start = end;
        }
        return result.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public static string Resolve(string? productCode, string? orderNos,
        IReadOnlyList<Product> products, IReadOnlyList<Schedule> schedules)
    {
        var codes = Codes(productCode, products.Select(p => p.Code).Concat(schedules.Select(s => s.Code)));
        var orders = (orderNos ?? "").Split([';', '；']).Select(p => p.Trim())
            .Where(p => p.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var customers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (codes.Count == 0) throw new InvalidOperationException("缺少货号，客户未能确认");
        foreach (var code in codes)
        {
            var linked = schedules.Where(s => s.Code.Equals(code, StringComparison.OrdinalIgnoreCase)
                && orders.Contains(s.OrderNo)).ToList();
            if (linked.Count > 0)
            {
                customers.UnionWith(linked.Select(s => Normalize(s.Customer)));
                continue;
            }
            var matches = products.Where(p => p.Code.Equals(code, StringComparison.OrdinalIgnoreCase)).ToList();
            if (matches.Count == 0 && !code.Contains('/'))
            {
                // Match the established TOMY suffix convention, but never shorten a Spin SKU.
                foreach (var candidate in new[] { Regex.Replace(code, "[A-Za-z]+$", ""), Regex.Match(code, @"^\d+").Value })
                {
                    if (candidate.Length == 0) continue;
                    matches = products.Where(p => p.Code.Equals(candidate, StringComparison.OrdinalIgnoreCase)).ToList();
                    if (matches.Count > 0) break;
                }
            }
            if (matches.Count == 0) throw new InvalidOperationException($"货号 {code} 的客户未能确认，请补齐货号客户资料或关联排期");
            customers.UnionWith(matches.Select(p => Normalize(p.Customer)));
        }
        if (customers.Count != 1) throw new InvalidOperationException("采购明细包含不同客户或客户归属不明确，不能合并");
        return customers.Single();
    }
}
