using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

public static class PartProcessRules
{
    public static string NameKey(string? value) =>
        new((value ?? "").Trim()
            .Replace('（', '(')
            .Replace('）', ')')
            .Where(c => !char.IsWhiteSpace(c))
            .Select(char.ToLowerInvariant)
            .ToArray());

    public static int CraftPriority(string? craft) => (craft ?? "").Trim() switch
    {
        "手喷" => 0,
        "自动喷" => 1,
        "移印" => 2,
        "UV" => 3,
        _ => 99,
    };

    public static List<ProductPart> SameLogicalPart(IEnumerable<ProductPart> parts, ProductPart anchor)
    {
        var groupId = anchor.PartGroupId > 0 ? anchor.PartGroupId : anchor.Id;
        var nameKey = NameKey(anchor.PartName);
        return parts
            .Where(p => p.ProductId == anchor.ProductId &&
                (p.PartGroupId > 0 ? p.PartGroupId == groupId : NameKey(p.PartName) == nameKey))
            .OrderBy(p => p.PartOrder)
            .ThenBy(p => p.Id)
            .ToList();
    }

    public static List<(int StepNo, string Craft)> ExpandPasses(IEnumerable<ProductPart> parts)
    {
        var list = parts.ToList();
        var crafts = list
            .Select(p => (p.Craft ?? "").Trim())
            .Where(c => c.Length > 0)
            .Distinct()
            .OrderBy(CraftPriority)
            .ToList();
        if (crafts.Count == 0) return new() { (1, "") };

        var passes = list.Select(p => p.CraftPasses).FirstOrDefault(v => v > 0);
        if (crafts.Count > 1) passes = Math.Max(passes, crafts.Count);
        if (passes <= 0) passes = 1;

        return Enumerable.Range(0, passes)
            .Select(i => (i + 1, crafts[i % crafts.Count]))
            .ToList();
    }

    public static void AssignGroupIds(IEnumerable<ProductPart> parts)
    {
        foreach (var group in parts.GroupBy(p => (p.ProductId, NameKey(p.PartName))))
        {
            var persisted = group.Where(p => p.Id > 0).ToList();
            var groupId = persisted.Select(p => p.Id).DefaultIfEmpty(0).Min();
            if (groupId <= 0) continue;
            foreach (var part in group) part.PartGroupId = groupId;
        }
    }
}
