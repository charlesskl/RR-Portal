namespace ErpApi.Engines.Bom;

// BOM 多层级半成品展开（旧版 ERP 规则）：
// - 一款产品设了半成品再设成品时，成品 BOM 调入先前设的半成品；多层级时半成品再调到上级半成品。
// - 半成品行判定（免加列方案）：BOM 明细行的"编号"在 半成品共用物料设置.产品货号 中存在即为半成品行。
// - 展开口径：遇到半成品行时不产出物料行，而是用该半成品自己的 BOM 递归替换展开，
//   用量沿层级逐层相乘；环（A→B→A）就地停止并标注警告；层级上限 MaxDepth。
// - 防重复出库：成品调入了半成品即按半成品 BOM 扣物料；若同一 BOM 既调半成品又直接列其组成物料，
//   FindDuplicateMaterialWarnings 给出保存警告（不强制阻止）。
public static class SemiBomExpander
{
    public const int MaxDepth = 10;

    // 递归展开一个款号的 BOM，返回叶级物料行（保留原行数据 + 沿层级累计的用量）与警告（环/超层级）。
    // getLines: 款号 → BOM 行；codeOf/qtyOf: 取行编号/用量；isSemi: 编号是否已设置的半成品款号。
    public static SemiBomExpansion<T> Expand<T>(
        string 根款号,
        Func<string, IReadOnlyList<T>> getLines,
        Func<T, string?> codeOf,
        Func<T, decimal?> qtyOf,
        Func<string, bool> isSemi)
    {
        var rows = new List<ExpandedSemiMaterial<T>>();
        var warnings = new List<string>();
        var path = new List<string> { 根款号 };
        Walk(根款号, 1m);
        return new SemiBomExpansion<T>(rows, warnings);

        void Walk(string 款号, decimal 倍率)
        {
            foreach (var line in getLines(款号))
            {
                var code = codeOf(line)?.Trim();
                if (string.IsNullOrEmpty(code)) continue;
                var 累计用量 = 倍率 * (qtyOf(line) ?? 0m);
                if (!isSemi(code))
                {
                    rows.Add(new ExpandedSemiMaterial<T>(line, 累计用量, 款号));
                    continue;
                }
                if (path.Contains(code, StringComparer.OrdinalIgnoreCase))
                {
                    warnings.Add($"检测到半成品循环引用：{string.Join("→", path)}→{code}，已停止向下展开。");
                    continue;
                }
                if (path.Count >= MaxDepth)
                {
                    warnings.Add($"半成品 [{code}] 超过最大层级 {MaxDepth}（路径：{string.Join("→", path)}），已停止向下展开。");
                    continue;
                }
                path.Add(code);
                Walk(code, 累计用量);
                path.RemoveAt(path.Count - 1);
            }
        }
    }

    // 保存校验：本 BOM 直接列出的物料，若同时是某个被调入半成品的（递归）组成物料，则出库会重复扣料。
    // 返回警告列表（不阻止保存）；展开过程中的环/超层级警告一并带回。
    public static IReadOnlyList<string> FindDuplicateMaterialWarnings(
        IReadOnlyList<SemiBomLine> 本Bom行,
        Func<string, IReadOnlyList<SemiBomLine>> getLines,
        Func<string, bool> isSemi)
    {
        var directMaterials = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var semiCodes = new List<string>();
        foreach (var line in 本Bom行)
        {
            var code = line.编号?.Trim();
            if (string.IsNullOrEmpty(code)) continue;
            if (isSemi(code)) semiCodes.Add(code);
            else directMaterials.Add(code);
        }
        if (directMaterials.Count == 0 || semiCodes.Count == 0) return [];

        var warnings = new List<string>();
        foreach (var semi in semiCodes.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var expansion = Expand(semi, getLines, l => l.编号, l => l.用量, isSemi);
            foreach (var hit in expansion.物料
                .Select(m => m.行.编号!)
                .Where(directMaterials.Contains)
                .Distinct(StringComparer.OrdinalIgnoreCase))
                warnings.Add($"物料 [{hit}] 既直接列入本 BOM，又是半成品 [{semi}] 的组成物料；出库时会重复扣料，请保留其中一行。");
            warnings.AddRange(expansion.警告);
        }
        return warnings;
    }
}

public sealed record SemiBomLine(string? 编号, decimal? 用量);

public sealed record ExpandedSemiMaterial<T>(T 行, decimal 累计用量, string 来源款号);

public sealed record SemiBomExpansion<T>(
    IReadOnlyList<ExpandedSemiMaterial<T>> 物料,
    IReadOnlyList<string> 警告);
