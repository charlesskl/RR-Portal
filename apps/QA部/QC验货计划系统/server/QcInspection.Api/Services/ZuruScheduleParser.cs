using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.IO.Compression;
using System.Xml.Linq;
using ExcelDataReader;

namespace QcInspection.Api.Services;

public sealed record ZuruScheduleRow(string BusinessKey, string Customer, string Country, string PoNumber,
    string CustomerPo, string ItemNumber, string ProductName, decimal? Quantity, decimal? Cartons,
    DateTime? PlannedShipDate, DateTime? PlannedInspectionDate, DateTime? ThirdPartyInspectionDate,
    string InspectionResult, string Site, string ProductionWorkshop, string Sheet, int Row, string[] Issues,
    string InspectionLocation = "");

public sealed record ZuruParseResult(IReadOnlyList<ZuruScheduleRow> Rows, int CompletedSkipped, int InvalidSkipped,
    int AuxiliarySheetsSkipped, int ProductSheets);

public static class ZuruScheduleParser
{
    private static readonly string[] ExcludedSheetTerms = ["MA", "取消", "导出列表", "WpsReserved", "半成品", "车缝", "包装", "旧"];

    public static ZuruParseResult Parse(Stream stream)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        using var buffer = new MemoryStream(); stream.CopyTo(buffer); buffer.Position = 0;
        var blueRows = ReadBlueRows(buffer); buffer.Position = 0;
        using var reader = ExcelReaderFactory.CreateReader(buffer);
        var rows = new List<ZuruScheduleRow>();
        var completed = 0; var invalid = 0; var auxiliary = 0; var productSheets = 0;
        do
        {
            var sheetName = reader.Name; var excluded = ExcludedSheetTerms.Any(term => sheetName.Contains(term, StringComparison.OrdinalIgnoreCase));
            Dictionary<string, int>? headers = null; var rowNumber = 0;
            while (reader.Read())
            {
                rowNumber++; if (excluded) continue;
                if (headers is null)
                {
                    if (rowNumber > 12) continue;
                    var candidate = Headers(reader);
                    if (candidate.ContainsKey("中文名") || candidate.ContainsKey("中文名称") || candidate.ContainsKey("产品名称"))
                        if (candidate.ContainsKey("PO号") || candidate.ContainsKey("PO")) { headers = candidate; productSheets++; }
                    continue;
                }
                if (!Enumerable.Range(0, Math.Min(reader.FieldCount, 16)).Any(column => !string.IsNullOrWhiteSpace(Text(reader.GetValue(column))))) continue;
                string Get(params string[] names) => names.Select(Normalize).Where(headers.ContainsKey)
                    .Select(name => Text(reader.GetValue(headers[name]))).FirstOrDefault() ?? string.Empty;
                var product = Get("中文名", "中文名称", "产品名称");
                var po = Get("PO号", "PO"); var item = Get("ITEM#", "ITEM");
                var result = Get("驗貨結果", "验货结果");
                var shipping = Get("送货情况", "出货情况", "下单情况");
                if (blueRows.TryGetValue(sheetName, out var blue) && blue.Contains(rowNumber) || IsCompleted(result, shipping)) { completed++; continue; }
                var customerPo = Get("客户PO号", "客户PO", "客户 PO 号");
                var itemKey = Get("ITEM#", "ITEM");
                var customer = Get("第三方客户名称", "客户名称");
                if (IsSummaryRow(po, customer, itemKey, product)) continue;
                if (string.IsNullOrWhiteSpace(po) && string.IsNullOrWhiteSpace(customerPo) && string.IsNullOrWhiteSpace(itemKey)) { invalid++; continue; }
                var quantity = Number(Get("PO数量(pcs)", "PO数量")); var inspectionDate = Date(Get("计划验货期"));
                var issues = new List<string>();
                if (string.IsNullOrWhiteSpace(product)) issues.Add("产品名称为空");
                if (string.IsNullOrWhiteSpace(po)) issues.Add("PO号为空");
                if (quantity is null) issues.Add("数量为空或格式异常");
                if (inspectionDate is null) issues.Add("计划验货期为空或格式异常");
                var businessKey = Hash(string.Join('|', NormalizeValue(po), NormalizeValue(customerPo), NormalizeValue(item)));
                var workshop = Get("生产车间", "生产厂区", "工厂");
                rows.Add(new ZuruScheduleRow(businessKey, customer, Get("走货国家"), po,
                    customerPo, item, product, quantity, Number(Get("总箱数")),
                    Date(Get("计划出货期")), inspectionDate, Date(Get("第三方验货日期")), result,
                    ResolveSite(workshop, sheetName), workshop, sheetName, rowNumber, issues.ToArray()));
            }
            if (excluded || headers is null) auxiliary++;
        } while (reader.NextResult());
        return new(rows.GroupBy(row => row.BusinessKey).Select(group => group.Last()).ToArray(), completed, invalid, auxiliary, productSheets);
    }

    private static bool IsCompleted(string result, string shipping)
    {
        var pending = new[] { "待", "未", "计划", "预" };
        if (!string.IsNullOrWhiteSpace(result) && !pending.Any(result.Contains)) return true;
        return new[] { "已出", "已走", "完成", "已交" }.Any(shipping.Contains);
    }
    private static string ResolveSite(string workshop, string sheet) => (workshop + sheet) switch
    {
        var value when value.Contains("华登") => "华登",
        var value when value.Contains("湖南") || value.Contains("新邵") || value.Contains("邵阳") => "湖南",
        var value when value.Contains("兴信") || value.Contains("东莞") || value.Contains("A车间") || value.Contains("B车间") => "兴信",
        _ => "待分配",
    };
    private static bool IsSummaryRow(string po, string customer, string item, string product)
    {
        if (!string.IsNullOrWhiteSpace(item) || !string.IsNullOrWhiteSpace(product)) return false;
        if (po.Contains("验货期") || po.Contains("月份") || customer.Contains("验货期")) return true;
        return System.Text.RegularExpressions.Regex.IsMatch(customer.Trim(), @"^\d{1,2}月份?$") &&
            (decimal.TryParse(po.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out _) || string.IsNullOrWhiteSpace(po));
    }
    private static Dictionary<string, HashSet<int>> ReadBlueRows(Stream stream)
    {
        var result = new Dictionary<string, HashSet<int>>();
        try
        {
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read, true);
            XNamespace main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            XNamespace rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            XNamespace pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
            XDocument Load(string name) { using var input = zip.GetEntry(name)!.Open(); return XDocument.Load(input); }
            var styles = Load("xl/styles.xml");
            var fonts = styles.Descendants(main + "fonts").Elements(main + "font").Select(font => font.Element(main + "color")?.Attribute("rgb")?.Value).ToArray();
            var xfs = styles.Descendants(main + "cellXfs").Elements(main + "xf").Select(xf => (int?)xf.Attribute("fontId") ?? 0).ToArray();
            var workbook = Load("xl/workbook.xml"); var relations = Load("xl/_rels/workbook.xml.rels");
            var targets = relations.Descendants(pkg + "Relationship").ToDictionary(x => (string)x.Attribute("Id")!, x => (string)x.Attribute("Target")!);
            foreach (var sheet in workbook.Descendants(main + "sheet"))
            {
                var name = (string)sheet.Attribute("name")!; var id = (string)sheet.Attribute(rel + "id")!;
                if (!targets.TryGetValue(id, out var target)) continue;
                var path = target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target.Replace("../", "");
                var entry = zip.GetEntry(path); if (entry is null) continue;
                using var input = entry.Open(); var xml = XDocument.Load(input); var blue = new HashSet<int>();
                foreach (var row in xml.Descendants(main + "row"))
                {
                    var hits = row.Elements(main + "c").Take(16).Count(cell =>
                    {
                        var styleIndex = (int?)cell.Attribute("s") ?? 0;
                        if (styleIndex >= xfs.Length || xfs[styleIndex] >= fonts.Length) return false;
                        var rgb = fonts[xfs[styleIndex]]; if (rgb is null || rgb.Length < 6) return false;
                        rgb = rgb[^6..]; var r = Convert.ToInt32(rgb[..2], 16); var g = Convert.ToInt32(rgb[2..4], 16); var b = Convert.ToInt32(rgb[4..], 16);
                        return b >= 150 && b > r * 1.25 && b > g * 1.1;
                    });
                    if (hits >= 3 && int.TryParse((string?)row.Attribute("r"), out var number)) blue.Add(number);
                }
                result[name] = blue;
            }
        }
        catch { /* Field checks remain the safe fallback for malformed workbooks. */ }
        return result;
    }
    private static Dictionary<string, int> Headers(IExcelDataReader reader) => Enumerable.Range(0, Math.Min(reader.FieldCount, 40))
        .Select(index => (Name: Normalize(Text(reader.GetValue(index))), index))
        .Where(value => value.Name != "").GroupBy(value => value.Name).ToDictionary(group => group.Key, group => group.First().index);
    private static string Normalize(string value) => value.Replace(" ", "").Replace("\r", "").Replace("\n", "").Trim();
    private static string NormalizeValue(string value) => Normalize(value).ToUpperInvariant();
    private static string Text(object? value) => value is null or DBNull ? "" : value is DateTime date ? date.ToString("yyyy-MM-dd") : Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? "";
    private static decimal? Number(string value) => decimal.TryParse(value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var number) ? number : null;
    private static DateTime? Date(string value)
    {
        if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var serial) && serial > 0) try { return DateTime.FromOADate(serial).Date; } catch { return null; }
        return DateTime.TryParse(value, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.None, out var date) ? date.Date : null;
    }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
