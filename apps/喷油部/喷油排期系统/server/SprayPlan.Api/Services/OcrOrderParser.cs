using System.Globalization;
using System.Text.RegularExpressions;
using static SprayPlan.Api.Services.PdfImportParse;

namespace SprayPlan.Api.Services;

// 图片 OCR 的文字会被拆成单字/数字块，不能要求表头恰好是一个完整词。
// 利用「数量」「单价」的横向位置和款号所在左栏，把图片还原成待人工核对的草稿。
public static class OcrOrderParser
{
    private static readonly Regex DatePattern = new(@"(20\d{2})年(\d{1,2})月(\d{1,2})日", RegexOptions.Compiled);
    private static readonly Regex OrderPattern = new(@"[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*", RegexOptions.Compiled);

    public static (PdfTableExtractor.ImportHead Head, List<ProductRawLine> Rows) Extract(IReadOnlyList<PdfWord> words)
    {
        var rows = new List<ProductRawLine>();
        var orderNo = "";
        var dates = new List<DateTime>();
        foreach (var page in words.Select(w => w.Page).Distinct().OrderBy(x => x))
        {
            var pageWords = words.Where(w => w.Page == page).ToList();
            var quantityHeader = pageWords.FirstOrDefault(w => w.Text.Contains("数量"));
            var priceHeader = pageWords.FirstOrDefault(w => w.Text.Contains("单价"));
            if (quantityHeader is null || priceHeader is null) continue;
            var qtyX = quantityHeader.CenterX;
            var priceX = priceHeader.CenterX;
            if (orderNo.Length == 0)
                orderNo = pageWords.Where(w => w.Top > quantityHeader.Top).OrderByDescending(w => w.Top)
                    .Select(w => OrderPattern.Match(w.Text.ToUpperInvariant())).FirstOrDefault(match => match.Success)?.Value ?? "";

            // OCR 可能把「2026年09月18日」拆成 2026 / 年 / 09 / 月 / 18 / 日。
            var visualLines = new List<List<PdfWord>>();
            foreach (var word in pageWords.OrderByDescending(w => w.Top))
            {
                var line = visualLines.FirstOrDefault(items => Math.Abs(items[0].Top - word.Top) <= 18);
                if (line is null) { line = []; visualLines.Add(line); }
                line.Add(word);
            }
            foreach (var line in visualLines)
            {
                var text = string.Concat(line.OrderBy(w => w.Left).Select(w => w.Text));
                var match = DatePattern.Match(text);
                if (match.Success && DateTime.TryParseExact($"{match.Groups[1].Value}-{int.Parse(match.Groups[2].Value):D2}-{int.Parse(match.Groups[3].Value):D2}",
                        "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                    dates.Add(date);
            }

            var footer = pageWords.Where(w => w.Text.Contains("TOTAL", StringComparison.OrdinalIgnoreCase))
                .Select(w => w.Top).DefaultIfEmpty(0).Max();
            var qtyLeft = qtyX - (priceX - qtyX) * 0.55;
            var qtyRight = (qtyX + priceX) / 2;
            var qtyWords = pageWords.Where(w => w.Top < quantityHeader.Top - 15 && (footer == 0 || w.Top > footer + 8)
                    && w.CenterX >= qtyLeft && w.CenterX < qtyRight).OrderByDescending(w => w.Top).ToList();
            var qtyLines = new List<List<PdfWord>>();
            foreach (var word in qtyWords)
            {
                var line = qtyLines.FirstOrDefault(items => Math.Abs(items[0].Top - word.Top) <= 13);
                if (line is null) { line = []; qtyLines.Add(line); }
                line.Add(word);
            }
            var anchors = qtyLines.Select(line => new
            {
                Top = line.Average(w => w.Top),
                Qty = int.TryParse(string.Concat(line.OrderBy(w => w.Left).Select(w => w.Text)).Replace(",", "").Trim(), out var qty) ? qty : 0,
            }).Where(x => x.Qty > 0).OrderByDescending(x => x.Top).ToList();
            for (var i = 0; i < anchors.Count; i++)
            {
                var anchor = anchors[i];
                var high = i == 0 ? quantityHeader.Top : (anchors[i - 1].Top + anchor.Top) / 2;
                var low = i == anchors.Count - 1 ? footer : (anchor.Top + anchors[i + 1].Top) / 2;
                var cell = pageWords.Where(w => w.Top < Math.Min(high, quantityHeader.Top - 15) && w.Top > low).ToList();
                var productWord = cell.Where(w => w.CenterX < qtyX * 0.27)
                    .OrderByDescending(w => w.Top).Select(w => Regex.Match(w.Text, @"\d{4,6}"))
                    .FirstOrDefault(match => match.Success);
                if (productWord is null) continue;
                var productNo = productWord.Value;
                var nameWords = cell.Where(w => w.CenterX >= qtyX * 0.25 && w.CenterX < qtyX * 0.51).ToList();
                var nameLines = new List<List<PdfWord>>();
                foreach (var word in nameWords.OrderByDescending(w => w.Top))
                {
                    var line = nameLines.FirstOrDefault(items => Math.Abs(items[0].Top - word.Top) <= 15);
                    if (line is null) { line = []; nameLines.Add(line); }
                    line.Add(word);
                }
                var name = string.Concat(nameLines.SelectMany(line => line.OrderBy(w => w.Left)).Select(w => w.Text)).Trim();
                if (name.Length == 0) continue;
                var priceText = string.Concat(cell.Where(w => w.CenterX >= qtyRight && w.CenterX < priceX + (priceX - qtyX) * 0.5)
                    .OrderBy(w => w.Left).Select(w => w.Text));
                var priceMatch = Regex.Match(priceText.Replace(" ", ""), @"(?:HK\$)?(\d+\.\d+)");
                var price = priceMatch.Success && double.TryParse(priceMatch.Groups[1].Value, NumberStyles.Float,
                    CultureInfo.InvariantCulture, out var value) ? value : 0;
                rows.Add(new ProductRawLine(productNo, cell.Any(w => w.Text.Contains("MA", StringComparison.OrdinalIgnoreCase)), name, anchor.Qty, price));
            }
        }
        return (new PdfTableExtractor.ImportHead(orderNo, dates.FirstOrDefault(), dates.Skip(1).Cast<DateTime?>().FirstOrDefault()), rows);
    }
}
