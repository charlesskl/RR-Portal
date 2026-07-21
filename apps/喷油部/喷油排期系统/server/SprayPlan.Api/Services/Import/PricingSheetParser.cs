using System.Globalization;

namespace SprayPlan.Api.Services.Import;

public record ParsedPart(string ItemName, string PartName, string CraftDetail, string? Category,
    int DailyCapacity, int StdMachineCount, double LaborPrice, double UnitCost, double PaintCost, double QuotedPrice, string? Remark);
public record ParsedSheet(string SheetName, bool Recognized, string? UnrecognizedReason,
    string ProductNo, string SuggestedItemName, bool IsThreeLevel, List<ParsedPart> Parts);

// 把一个 sheet 的网格按「标准表头名」解析成三层结构。纯函数、不碰 DB/OpenXml。
// 识别条件：前 8 行内存在同时含「货名」「核价」的表头行。否则判为未识别。
public static class PricingSheetParser
{
    // 跳过这些汇总/对比行（按 货名/位置 文本判断）
    static readonly string[] SkipWords = { "相差", "合计", "小计", "总计" };

    public static ParsedSheet Parse(string?[][] grid, string sheetName)
    {
        int headerRow = -1;
        Dictionary<string, int> cols = new();
        for (int r = 0; r < grid.Length && r < 8; r++)
        {
            var map = new Dictionary<string, int>();
            var row = grid[r];
            for (int c = 0; c < row.Length; c++)
            {
                var t = row[c]?.Trim();
                if (!string.IsNullOrEmpty(t) && !map.ContainsKey(t)) map[t] = c;
            }
            if (map.ContainsKey("货名") && map.ContainsKey("核价")) { headerRow = r; cols = map; break; }
        }
        if (headerRow < 0)
            return new ParsedSheet(sheetName, false, "未找到标准表头（需含「货名」「核价」列），已跳过", "", "", false, new());

        bool three = cols.ContainsKey("位置");
        int Col(string k) => cols.TryGetValue(k, out var v) ? v : -1;
        int cNo = Col("货号"), cName = cols["货名"], cPos = three ? cols["位置"] : -1, cCraft = Col("工序"),
            cCap = Col("目标数"), cPpl = Col("人数"), cLabor = Col("工价"), cUnit = cols["核价"],
            cPaint = Col("油漆价"), cQuote = Col("报价"), cRemark = Col("备注");

        static string Cell(string?[] row, int c) => c >= 0 && c < row.Length ? (row[c]?.Trim() ?? "") : "";
        static double D(string?[] row, int c)
        { var t = Cell(row, c); return double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0; }
        static int I(string?[] row, int c)
        { var t = Cell(row, c); return double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? (int)Math.Round(v) : 0; }

        string productNo = "";
        string lastItem = "";   // 三层时沿用合并货名
        var parts = new List<ParsedPart>();

        for (int r = headerRow + 1; r < grid.Length; r++)
        {
            var row = grid[r];
            var no = Cell(row, cNo);
            if (no != "" && productNo == "") productNo = no;

            var nameCell = Cell(row, cName);
            if (nameCell != "") lastItem = nameCell;

            string itemName, partName;
            if (three)
            {
                itemName = lastItem;
                var pos = Cell(row, cPos);
                partName = pos != "" ? pos : nameCell; // 位置空时退回货名（该子件单部位）
            }
            else
            {
                // 两层表每行独立，货名为空即空行/汇总行，不沿用上一行
                partName = nameCell;
                itemName = ""; // 两层稍后统一填公共前缀
            }

            if (string.IsNullOrEmpty(partName)) continue;                         // 空行
            if (SkipWords.Any(w => partName.Contains(w) || itemName.Contains(w))) continue; // 汇总行

            var craftDetail = Cell(row, cCraft);
            parts.Add(new ParsedPart(itemName, partName, craftDetail, CraftClassifier.Classify(craftDetail),
                I(row, cCap), I(row, cPpl), D(row, cLabor), D(row, cUnit), D(row, cPaint), D(row, cQuote),
                cRemark >= 0 ? (Cell(row, cRemark) is var rm && rm != "" ? rm : null) : null));
        }

        if (productNo == "") productNo = sheetName;

        string suggested = "";
        if (!three)
        {
            var partNames = parts.Select(p => p.PartName).ToList();
            suggested = CommonPrefix(partNames);                 // 遗留显示字段，保持兼容
            var items = DeriveSubItems(partNames);               // 逐部位归类出子件
            parts = parts.Select((p, i) => p with { ItemName = items[i] }).ToList();
        }

        return new ParsedSheet(sheetName, true, null, productNo, suggested, three, parts);
    }

    // 两层表子件归类（spec §4）。入参=各行货名(原文,保序,可重复)，返回等长的子件名列表。
    // 1) 本体优先：货名 A 是货名 B 的更短前缀 → B 归到 A，顺链取最短本体。
    // 2) 共同前缀：剩下的 base 按前 2 字分组，组内 ≥2 个时整组改名为该组最长公共前缀(≥2字)。
    //    按"前 2 字"分组天然区分"小猫/小狗"，长度≥2阈值防单字误并。
    // 3) 其余：子件 = 货名本身（如"猫头鹰眼睛"无本体无兄弟，留待预览页手改）。
    public static List<string> DeriveSubItems(List<string> partNames)
    {
        // Pass 1：本体优先
        string BaseOf(string name)
        {
            var cur = name;
            while (true)
            {
                string? shorter = null;
                foreach (var other in partNames)
                    if (other.Length < cur.Length
                        && cur.StartsWith(other, StringComparison.Ordinal)
                        && (shorter == null || other.Length < shorter.Length))
                        shorter = other;
                if (shorter == null) return cur;
                cur = shorter;
            }
        }
        var bases = partNames.Select(BaseOf).ToList();

        // Pass 2：共同前缀（对去重后的 base 分组改名）
        var distinct = bases.Distinct().ToList();
        var finalName = distinct.ToDictionary(b => b, b => b);   // 默认=自身
        foreach (var g in distinct.Where(b => b.Length >= 2).GroupBy(b => b[..2]))
        {
            var members = g.ToList();
            if (members.Count < 2) continue;
            var lcp = CommonPrefix(members);
            if (lcp.Length >= 2)
                foreach (var m in members) finalName[m] = lcp;
        }

        // Pass 3：映射回每一行
        return bases.Select(b => finalName[b]).ToList();
    }

    // 最长公共前缀（用于两层表猜子件名，如 联合收割机右身/车底 → 联合收割机）
    static string CommonPrefix(List<string> names)
    {
        if (names.Count == 0) return "";
        var prefix = names[0];
        foreach (var n in names.Skip(1))
        {
            int i = 0;
            while (i < prefix.Length && i < n.Length && prefix[i] == n[i]) i++;
            prefix = prefix[..i];
            if (prefix == "") break;
        }
        return prefix.Trim();
    }
}
