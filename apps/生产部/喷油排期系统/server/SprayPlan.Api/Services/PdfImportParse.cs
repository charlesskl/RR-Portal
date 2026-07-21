using System.Text.RegularExpressions;

namespace SprayPlan.Api.Services;

// PDF 委托加工合同导入 —— 后端纯逻辑解析函数。
// 不依赖任何 PDF 库，全部可直接单测。
// 数据流：PDF提取原始文本 → 本文件各函数逐步加工 → 可直接写入订单草稿。
public static class PdfImportParse
{
    // ─────────────────────────────────────────────────────────────────────────
    // Record 类型定义（positional record，支持解构和简洁构造）
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>解析款号的结果：款号数字串 + 是否含 MA 标记</summary>
    public record ProductNoMa(string ProductNo, bool IsMa);

    /// <summary>PDF 原始明细行：子件名（含后缀）+ 本行数量</summary>
    public record RawLine(string ItemRaw, int Qty);

    /// <summary>按子件合计后的聚合结果</summary>
    public record AggItem(string ItemName, int TotalQty, int MergedRows);

    /// <summary>含原始名+归一名+合计的草稿行，供前端预览和匹配</summary>
    public record DraftLine(string PdfItemName, string NormalizedName, int TotalQty, int MergedRows);

    /// <summary>匹配产品库后的结果行：MatchedItemName 非 null = 绿（命中），null = 红（未命中）</summary>
    public record MatchedLine(string PdfItemName, int TotalQty, int MergedRows, string? MatchedItemName);

    // ─────────────────────────────────────────────────────────────────────────
    // 函数 1：ParseProductNoAndMa
    // 从单元格文本提取款号（连续数字串）和 MA 标记。
    // 例："15787 总MA" → ProductNo="15787", IsMa=true
    // 假设：款号是该格里最靠前的连续数字串（真实委托加工合同款号格只有一个数字串）。
    // ─────────────────────────────────────────────────────────────────────────
    public static ProductNoMa ParseProductNoAndMa(string cell)
    {
        var s = cell?.Trim() ?? "";
        // MA 标记不区分大小写
        bool isMa = s.Contains("MA", StringComparison.OrdinalIgnoreCase);
        // 提取第一段连续数字作为款号
        var m = Regex.Match(s, @"\d+");
        return new ProductNoMa(m.Success ? m.Value : "", isMa);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 函数 2：NormalizeItemName
    // 砍掉"(印喷件)"/"（印喷件）"（半角/全角括号）后缀，用于与产品库子件名精确对比。
    // 例："兔子(印喷件)" → "兔子"
    // 只处理普通空格；PDF 提取若含零宽/非断行空格，调用方应先规范化文本。
    // ─────────────────────────────────────────────────────────────────────────
    public static string NormalizeItemName(string raw)
    {
        var s = (raw ?? "").Trim();
        // 匹配半角(或全角（，内部可有空格，半角)或全角），位于字符串末尾
        s = Regex.Replace(s, @"[\(（]\s*印喷件\s*[\)）]\s*$", "");
        return s.Trim();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 函数 3：AggregateByItem
    // 将 PDF 中按颜色/款式展开的多行，按归一子件名合并。
    // 保持首次出现顺序，返回每个子件的合计数量和合并行数。
    // 假设：子件名大小写/全半角在同一份 PDF 内一致（PdfPig 同源提取，型号如 E-11-06 大小写稳定），不做大小写归一。
    // ─────────────────────────────────────────────────────────────────────────
    public static List<AggItem> AggregateByItem(IEnumerable<RawLine> rows)
    {
        var order = new List<string>();           // 保持首次出现顺序
        var qty   = new Dictionary<string, int>(); // 各子件累计数量
        var cnt   = new Dictionary<string, int>(); // 各子件合并行数

        foreach (var r in rows)
        {
            var name = NormalizeItemName(r.ItemRaw);
            if (!qty.ContainsKey(name))
            {
                order.Add(name);
                qty[name] = 0;
                cnt[name] = 0;
            }
            qty[name] += r.Qty;
            cnt[name] += 1;
        }

        return order.Select(n => new AggItem(n, qty[n], cnt[n])).ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 函数 4：BuildDraftLines
    // 在 AggregateByItem 基础上，额外保留每个子件首次出现的原始 PDF 名称，
    // 用于前端预览时回显 PDF 中的原始写法。
    // ─────────────────────────────────────────────────────────────────────────
    public static List<DraftLine> BuildDraftLines(IEnumerable<RawLine> rows)
    {
        // 先遍历一次记录每个归一名对应的首次原始名
        var firstRaw = new Dictionary<string, string>();
        // 将 rows 具体化，避免 IEnumerable 多次枚举问题
        var rowList = rows.ToList();

        foreach (var r in rowList)
        {
            var n = NormalizeItemName(r.ItemRaw);
            if (!firstRaw.ContainsKey(n))
                firstRaw[n] = r.ItemRaw.Trim();
        }

        // 聚合
        var agg = AggregateByItem(rowList);

        return agg.Select(a => new DraftLine(
            PdfItemName:    firstRaw[a.ItemName],
            NormalizedName: a.ItemName,
            TotalQty:       a.TotalQty,
            MergedRows:     a.MergedRows
        )).ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 函数 5：MatchItems
    // 将草稿行的归一名与产品库子件名集合精确比对：
    //   命中 → MatchedItemName = 归一名（绿）
    //   未命中 → MatchedItemName = null（红）
    // 产品库名称会先去首尾空格再建集合，容错数据库脏数据。
    // 注意：MatchedItemName 命中时返回归一名（非产品库原始名）；调用方据此查库需自行 Trim 容差。
    // ─────────────────────────────────────────────────────────────────────────
    public static List<MatchedLine> MatchItems(
        IEnumerable<DraftLine> lines,
        IEnumerable<string> productItemNames)
    {
        // 用 HashSet 保证 O(1) 查找，同时对产品库名称做 Trim 容错
        var set = new HashSet<string>(productItemNames.Select(n => n.Trim()));

        return lines.Select(l => new MatchedLine(
            PdfItemName:      l.PdfItemName,
            TotalQty:         l.TotalQty,
            MergedRows:       l.MergedRows,
            MatchedItemName:  set.Contains(l.NormalizedName) ? l.NormalizedName : null
        )).ToList();
    }
}
