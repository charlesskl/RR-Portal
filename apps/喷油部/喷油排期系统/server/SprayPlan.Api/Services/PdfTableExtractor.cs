using System.Globalization;
using System.Text.RegularExpressions;
using static SprayPlan.Api.Services.PdfImportParse;

namespace SprayPlan.Api.Services;

// PDF 委托加工合同的"几何还原"层：输入一堆带坐标的词，依据表头列位置把表格还原成结构化行。
// 纯逻辑、不依赖 PdfPig，可由 fixture 直接单测。
//
// 坐标系：PDF 原生，原点左下角，Y(Top/Bottom) 越大越靠页面上方。
// 整体思路：
//   1) 用表头词（款号/物料名称/数量...）的中心 X 推出各列的边界（相邻中心 X 的中点）。
//      —— 不硬编码像素，模板换了字号/微移也能跟着走。
//   2) 表头行 Y 以下、表尾(TOTAL/备注)以上为表体；
//      以"数量列里能解析成整数的词"为逻辑行锚点，按相邻锚点中点切出每行的 Y 区间。
//   3) 物料名称列在该 Y 区间内的词，按 Y 上→下、X 左→右拼成物料原始名。
public static class PdfTableExtractor
{
    /// <summary>抬头字段：外部订单编号 + 订单日期 + 交货日期(可空)。</summary>
    public record ImportHead(string ExternalOrderNo, DateTime OrderDate, DateTime? DeliveryDate);

    // 表头各列的文本（顺序即从左到右）。用于定位列中心 X。
    private static readonly string[] HeaderTexts =
    {
        "款号", "物料名称", "用料名称", "颜色", "单重G", "总重KG", "数量", "单价", "金额(HK$)", "备注"
    };

    // 视觉行聚类容差（同一视觉行的 Top 差不超过此值）。真实行内词 Top 差 < 3。
    private const double RowClusterTol = 3.0;

    // ─────────────────────────────────────────────────────────────────────────
    // 内部：表格几何上下文（列边界 + 表头/表尾 Y），一次算好供各抽取函数复用。
    // ─────────────────────────────────────────────────────────────────────────
    private sealed class TableGeometry
    {
        // 各表头词的水平边界（按 HeaderTexts 顺序，找不到的列为 null）。
        // 用 Left/Right 而非中心，是为了把列边界落在表头词之间的"空白档"里——
        // 这样像"熊"这种单字物料(其中心略偏向款号中心)也能正确归入物料列。
        public (double Left, double Right)?[] ColBox = new (double, double)?[HeaderTexts.Length];
        // 表头行 Y（用表头词 Top 的平均近似），表体在它下方
        public double HeaderTop;
        // 表尾 Y（TOTAL 行的 Top），表体在它上方；找不到则为 0（取到页底）
        public double FooterTop;

        // 列索引常量，便于读
        public int IdxProductNo => 0;   // 款号
        public int IdxItemName  => 1;   // 物料名称
        public int IdxQty       => 6;   // 数量

        // 判断词中心 X 落入哪一列；返回 HeaderTexts 索引，落在所有列之外返回 -1。
        // 列边界 = 相邻两表头词之间空白档的中点（leftCol.Right 与 rightCol.Left 的中点）；
        // 首列左界 = 首个表头词左缘左移半档；末列右界 = 末个表头词右缘右移半档。
        public int ColumnOf(double centerX)
        {
            // 收集存在的列，按左缘排序
            var present = new List<(int idx, double left, double right)>();
            for (int i = 0; i < ColBox.Length; i++)
                if (ColBox[i] is (double l, double r))
                    present.Add((i, l, r));
            if (present.Count == 0) return -1;
            present.Sort((a, b) => a.left.CompareTo(b.left));

            // 计算每个存在列的 [lo, hi) 边界
            for (int k = 0; k < present.Count; k++)
            {
                double lo, hi;
                if (k == 0)
                {
                    // 首列左界：左缘再向左留半个"到右邻档"的余量
                    double gapRight = present.Count > 1
                        ? (present[0].right + present[1].left) / 2.0
                        : present[0].right + 10;
                    double width = gapRight - present[0].left;
                    lo = present[0].left - width; // 足够宽，容下左溢出
                }
                else
                {
                    lo = (present[k - 1].right + present[k].left) / 2.0;
                }

                if (k == present.Count - 1)
                {
                    double gapLeft = present.Count > 1
                        ? (present[k - 1].right + present[k].left) / 2.0
                        : present[k].left - 10;
                    double width = present[k].right - gapLeft;
                    hi = present[k].right + width; // 足够宽，容下右溢出
                }
                else
                {
                    hi = (present[k].right + present[k + 1].left) / 2.0;
                }

                if (centerX >= lo && centerX < hi)
                    return present[k].idx;
            }
            return -1;
        }
    }

    // 在某一页的词里建立表格几何。找不到表头则返回 null。
    private static TableGeometry? BuildGeometry(IReadOnlyList<PdfWord> pageWords)
    {
        var geo = new TableGeometry();

        // 1) 定位每个表头词的中心 X 与 Top。表头词彼此 Top 接近（同一行）。
        //    先粗找所有候选，再用"数量"等关键词确定表头行 Y，过滤掉同名干扰词。
        // 收集每个表头文本的候选（可能多处出现，如正文里也有"备注"二字概率低，但稳妥起见取表头那一行）。
        var candidates = new List<(int idx, PdfWord w)>();
        for (int i = 0; i < HeaderTexts.Length; i++)
        {
            foreach (var w in pageWords)
            {
                if (w.Text == HeaderTexts[i])
                    candidates.Add((i, w));
            }
        }
        if (candidates.Count == 0) return null;

        // 表头行 Y：用"款号/物料名称/数量"这类核心列候选里出现最多的那个 Top 簇。
        // 简化：把所有候选 Top 聚类，取候选数最多的簇作为表头行。
        var clusters = new List<(double top, List<(int idx, PdfWord w)> items)>();
        foreach (var c in candidates.OrderByDescending(x => x.w.Top))
        {
            var hit = clusters.FirstOrDefault(cl => Math.Abs(cl.top - c.w.Top) <= RowClusterTol);
            if (hit.items == null)
                clusters.Add((c.w.Top, new List<(int, PdfWord)> { c }));
            else
                hit.items.Add(c);
        }
        var headerCluster = clusters.OrderByDescending(cl => cl.items.Count).First();

        // 表头线取簇内"最低"的表头词 Top（Min），而非平均值。
        // 真机里同一表头行各词 Top 有亚像素抖动（如 款号 628.14、物料名称/数量 628.10），
        // 用平均值会把低于均值的表头词（物料名称/数量）误判成表体 → 表头文字窜进首行子件名。
        // 取 Min 后所有表头词都 >= 表头线，InBody 能把它们全部排除；数据行 Top 远低于此，不受影响。
        geo.HeaderTop = headerCluster.items.Min(x => x.w.Top);
        foreach (var (idx, w) in headerCluster.items)
        {
            // 同一表头文本若簇内重复，取第一个即可。
            geo.ColBox[idx] ??= (w.Left, w.Right);
        }

        // 2) 表尾 Y：找表头下方的 "TOTAL：" 词的 Top（明细区到此为止）。
        double footerTop = 0;
        foreach (var w in pageWords)
        {
            if (w.Top < geo.HeaderTop && w.Text.Contains("TOTAL"))
            {
                if (w.Top > footerTop) footerTop = w.Top;
            }
        }
        geo.FooterTop = footerTop; // 0 = 没找到，取到页底

        return geo;
    }

    // 词是否落在表体区域（表头之下、表尾之上）。
    private static bool InBody(PdfWord w, TableGeometry geo)
    {
        if (w.Top >= geo.HeaderTop) return false;
        // 假设：表尾（TOTAL/备注）行本身不含数据行；
        // `<=` 故意把与 FooterTop 同 Y 的行排除——TOTAL 行自身不应计入表体。
        if (geo.FooterTop > 0 && w.Top <= geo.FooterTop) return false;
        return true;
    }

    // 把单元格内的词按"视觉行"还原阅读顺序：
    //   先把 Top 相差 ≤ RowClusterTol 的词聚成同一视觉行，行间上→下、行内左→右。
    // 为何不能直接 OrderByDescending(Top).ThenBy(Left)：
    //   真机里同一行各词 Top 有亚像素抖动（如 兔子 589.53、(印喷件) 589.45），
    //   纯按 Top 排会让后缀(印喷件)抢到动物字前面 → 子件名顺序颠倒"(印喷件)兔子"。
    private static List<PdfWord> OrderCellWords(IEnumerable<PdfWord> words)
    {
        // 按 Top 降序遍历，逐词归入"首词 Top 在容差内"的已有行，否则新建行。
        // 因遍历是降序，新建的行总是更靠下，故 lines 天然按上→下有序。
        var lines = new List<List<PdfWord>>();
        foreach (var w in words.OrderByDescending(x => x.Top))
        {
            var line = lines.FirstOrDefault(ln => Math.Abs(ln[0].Top - w.Top) <= RowClusterTol);
            if (line == null) { line = new List<PdfWord>(); lines.Add(line); }
            line.Add(w);
        }

        var result = new List<PdfWord>();
        foreach (var ln in lines)
            result.AddRange(ln.OrderBy(w => w.Left)); // 行内左→右
        return result;
    }

    // 解析数量文本（去千分位逗号）；失败返回 null。
    private static int? ParseQty(string text)
    {
        var s = text.Replace(",", "").Trim();
        if (s.Length == 0) return null;
        return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : (int?)null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ExtractRows：遍历所有页，抽出每条逻辑行的(物料原始名, 数量)。
    // ─────────────────────────────────────────────────────────────────────────
    public static List<RawLine> ExtractRows(IReadOnlyList<PdfWord> words)
    {
        var result = new List<RawLine>();

        foreach (var pageNo in words.Select(w => w.Page).Distinct().OrderBy(x => x))
        {
            var pageWords = words.Where(w => w.Page == pageNo).ToList();
            var geo = BuildGeometry(pageWords);
            if (geo == null) continue;

            // 表体词
            var body = pageWords.Where(w => InBody(w, geo)).ToList();

            // 1) 找锚点：数量列里能解析成整数的词。
            var anchors = body
                .Where(w => geo.ColumnOf(w.CenterX) == geo.IdxQty && ParseQty(w.Text) is not null)
                .OrderByDescending(w => w.Top) // Y 大→小 = 页面上→下
                .ToList();
            if (anchors.Count == 0) continue;

            // 2) 为每个锚点算 Y 区间（上界 hiTop / 下界 loTop，均按 Top 值）。
            //    相邻锚点用中点切分；首锚向上延伸到表头，末锚向下延伸到表尾。
            for (int i = 0; i < anchors.Count; i++)
            {
                var anchor = anchors[i];

                double hiTop = (i == 0)
                    ? geo.HeaderTop
                    : (anchors[i - 1].Top + anchor.Top) / 2.0;

                double loTop = (i == anchors.Count - 1)
                    ? (geo.FooterTop > 0 ? geo.FooterTop : double.MinValue)
                    : (anchor.Top + anchors[i + 1].Top) / 2.0;

                // 3) 物料名称列在该 Y 区间内的词，按视觉行还原顺序后拼接。
                var nameWords = OrderCellWords(body
                    .Where(w => geo.ColumnOf(w.CenterX) == geo.IdxItemName
                                && w.Top <= hiTop && w.Top > loTop));

                var itemRaw = string.Concat(nameWords.Select(w => w.Text)).Trim();
                var qty = ParseQty(anchor.Text)!.Value;

                result.Add(new RawLine(itemRaw, qty));
            }
        }

        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ExtractProductNoCell：款号格内容（整单级）。取所有页款号列、表体内的词拼接。
    // ─────────────────────────────────────────────────────────────────────────
    public static string ExtractProductNoCell(IReadOnlyList<PdfWord> words)
    {
        var parts = new List<string>();

        foreach (var pageNo in words.Select(w => w.Page).Distinct().OrderBy(x => x))
        {
            var pageWords = words.Where(w => w.Page == pageNo).ToList();
            var geo = BuildGeometry(pageWords);
            if (geo == null) continue;

            var cellWords = OrderCellWords(pageWords
                .Where(w => InBody(w, geo) && geo.ColumnOf(w.CenterX) == geo.IdxProductNo));

            foreach (var w in cellWords)
                parts.Add(w.Text);
        }

        return string.Join(" ", parts).Trim();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ExtractHead：抬头字段（标签近邻取值），从第 1 页抽取。
    // ─────────────────────────────────────────────────────────────────────────
    private static readonly Regex CnDate = new(@"(\d{4})年(\d{2})月(\d{2})日", RegexOptions.Compiled);

    public static ImportHead ExtractHead(IReadOnlyList<PdfWord> words)
    {
        // 抬头都在第 1 页。
        var page1 = words.Where(w => w.Page == 1).ToList();
        if (page1.Count == 0) page1 = words.ToList();

        // 同一视觉行：Top 差 <= RowClusterTol。
        // 取标签词右侧（Left 更大）同一行里的首个词。
        PdfWord? RightOf(PdfWord label) =>
            page1
                .Where(w => Math.Abs(w.Top - label.Top) <= RowClusterTol && w.Left > label.Left)
                .OrderBy(w => w.Left)
                .FirstOrDefault();

        // 1) 订单编号：标签右侧词
        string externalOrderNo = "";
        var orderNoLabel = page1.FirstOrDefault(w => w.Text.Contains("订单编号"));
        if (orderNoLabel != null && RightOf(orderNoLabel) is PdfWord onv)
            externalOrderNo = onv.Text.Trim();

        // 2) 日期：标签"日 期："可能被拆成多词("日" + "期：")。
        //    先找含"日"且其同行右侧能解析出中文日期的标签行。
        //    实现：找同行里第一个能被 CnDate 命中的词，且该行存在"期"字标签。
        DateTime orderDate = default;
        // "期：" 词通常与"日"同行；取该行最靠右的中文日期。
        var qiLabel = page1.FirstOrDefault(w =>
            (w.Text.Contains("期：") || w.Text.Contains("期:"))
            && !w.Text.Contains("交货") && !w.Text.Contains("付款"));
        if (qiLabel != null)
        {
            var dateWord = page1
                .Where(w => Math.Abs(w.Top - qiLabel.Top) <= RowClusterTol && w.Left > qiLabel.Left)
                .Select(w => CnDate.Match(w.Text))
                .FirstOrDefault(m => m.Success);
            if (dateWord != null && dateWord.Success)
                orderDate = ToDate(dateWord);
        }

        // 3) 交货日期：含"交货日期"标签，其右侧中文日期；
        //    本模板交货日期在标签左/上方另一词（见 fixture：日期词在"交货日期："左侧）。
        //    稳妥：取与"交货日期"标签同一视觉行里能解析出中文日期的任意词。
        DateTime? deliveryDate = null;
        var delLabel = page1.FirstOrDefault(w => w.Text.Contains("交货日期"));
        if (delLabel != null)
        {
            var m = page1
                .Where(w => Math.Abs(w.Top - delLabel.Top) <= RowClusterTol)
                .Select(w => CnDate.Match(w.Text))
                .FirstOrDefault(x => x.Success);
            if (m != null && m.Success)
                deliveryDate = ToDate(m);
        }

        return new ImportHead(externalOrderNo, orderDate, deliveryDate);
    }

    private static DateTime ToDate(Match m) =>
        new DateTime(
            int.Parse(m.Groups[1].Value),
            int.Parse(m.Groups[2].Value),
            int.Parse(m.Groups[3].Value));
}
