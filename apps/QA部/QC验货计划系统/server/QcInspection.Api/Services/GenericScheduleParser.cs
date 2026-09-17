using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using ExcelDataReader;

namespace QcInspection.Api.Services;

public static class GenericScheduleParser
{
    private static readonly string[] AlwaysExcluded = ["旧", "总接单", "已走货", "已出货", "取消", "MA", "IC", "半成品", "车缝", "包装", "WpsReserved", "导出"];
    private static readonly Dictionary<string, string[]> SpecialSheets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Sky Castle"] = ["一二代排期", "三代排期", "蛋糕系列"],
        ["TOMY Indonesia"] = ["总排期"],
        ["TIGERHEAD"] = ["A车间总排期", "B车间总排期", "印尼总排期"],
        ["Masterkidz"] = ["东莞兴信排期", "印尼排期"],
        ["JAZ/JWC"] = ["客排", "仓排"],
        ["CEPIA"] = ["解压公仔排期", "ZHUZHU鱼", "老鼠排期", "Wand", "泡泡贴女款", "泡泡贴男款", "DECORA", "11寸公仔"],
        ["Toy Monster"] = ["正在做货"],
        ["ZANZOON"] = ["总排期"],
    };

    public static ZuruParseResult Parse(Stream stream, string source)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        using var buffer = new MemoryStream(); stream.CopyTo(buffer); buffer.Position = 0;
        var legacyXls = buffer.Length < 2 || buffer.GetBuffer()[0] != 'P' || buffer.GetBuffer()[1] != 'K';
        var colors = ReadRowColors(buffer); buffer.Position = 0;
        using var reader = ExcelReaderFactory.CreateReader(buffer);
        var rows = new List<ZuruScheduleRow>(); var skipped = 0; var invalid = 0; var auxiliary = 0; var productSheets = 0;
        do
        {
            var sheet = reader.Name; var excluded = !IncludeSheet(source, sheet); Dictionary<string, int>? headers = null; var rowNumber = 0;
            while (reader.Read())
            {
                rowNumber++; if (excluded) continue;
                if (headers is null)
                {
                    if (rowNumber > 15) continue;
                    var candidate = Headers(reader);
                    if (Has(candidate, PoHeaders) && (Has(candidate, ItemHeaders) || Has(candidate, ProductHeaders))) { headers = candidate; productSheets++; }
                    continue;
                }
                if (!Enumerable.Range(0, Math.Min(reader.FieldCount, 30)).Any(i => !string.IsNullOrWhiteSpace(Text(reader.GetValue(i))))) continue;
                string Get(params string[] names) => names.Select(Normalize).Where(headers.ContainsKey).Select(n => Text(reader.GetValue(headers[n]))).FirstOrDefault() ?? "";
                var po = Get(PoHeaders); var customerPo = Get(CustomerPoHeaders); var item = Get(ItemHeaders); var product = Get(ProductHeaders);
                var customer = Get(CustomerHeaders); var quantity = Number(Get(QuantityHeaders)); var inspection = Date(Get(InspectionDateHeaders));
                var inspectionResult = Get("验货结果", "第三方验货结果");
                if (IsSummary(po, customer, item, product) || string.IsNullOrWhiteSpace(po) && string.IsNullOrWhiteSpace(customerPo) && string.IsNullOrWhiteSpace(item)) { invalid++; continue; }
                if (colors.TryGetValue(sheet, out var rowColors) && rowColors.TryGetValue(rowNumber, out var color) && color is "pink" or "red") { skipped++; continue; }
                if (IsCompletedInspection(inspectionResult)) { skipped++; continue; }
                var issues = new List<string>();
                if (legacyXls) issues.Add("旧版xls无法核验字体颜色，请转存xlsx后重新预览");
                if (string.IsNullOrWhiteSpace(product) && !source.Equals("Sky Castle", StringComparison.OrdinalIgnoreCase)) issues.Add("产品名称为空");
                if (string.IsNullOrWhiteSpace(po)) issues.Add("PO号为空");
                if (quantity is null) issues.Add("数量为空或格式异常");
                if (inspection is null) issues.Add("计划验货期为空或格式异常");
                if (colors.TryGetValue(sheet, out rowColors) && rowColors.TryGetValue(rowNumber, out color) && color.StartsWith("mixed:"))
                    issues.Add($"字体颜色不一致（{color[6..]}）");
                var key = Hash(string.Join('|', Normalize(source), Normalize(po), Normalize(customerPo), Normalize(item)));
                var workshop = Get("生产车间", "生产厂区", "工厂", "做货工厂", "厂区");
                rows.Add(new(key, customer, Get("国家", "走货国家"), po, customerPo, item, product, quantity,
                    Number(Get("总箱数", "箱数")), Date(Get("出货期", "走货期", "PO走货期", "计划出货期", "RR回复出货期")), inspection,
                    Date(Get("第三方QC验货期", "第三方验货日期")), inspectionResult,
                    ResolveSite(source, workshop, sheet), workshop, sheet, rowNumber, issues.ToArray(),
                    Get("验货/抽板地点", "验货地点", "验货地")));
            }
            if (excluded || headers is null) auxiliary++;
        } while (reader.NextResult());
        return new(rows.GroupBy(x => x.BusinessKey).SelectMany(group => group.Count() == 1 || group.All(row =>
            row.PlannedInspectionDate == group.First().PlannedInspectionDate && row.Quantity == group.First().Quantity &&
            row.ProductName == group.First().ProductName) ? group.Take(1) : group.Select(row => row with
        {
            BusinessKey = Hash($"{row.BusinessKey}|{row.Sheet}|{row.Row}"),
            Issues = row.Issues.Append("文件内同一订单货号重复安排，需单独核对").ToArray()
        })).ToArray(), skipped, invalid, auxiliary, productSheets);
    }

    private static bool IncludeSheet(string source, string sheet)
    {
        if (AlwaysExcluded.Any(x => sheet.Contains(x, StringComparison.OrdinalIgnoreCase))) return false;
        if (SpecialSheets.TryGetValue(source, out var names)) return names.Any(x => sheet.Contains(x, StringComparison.OrdinalIgnoreCase));
        return sheet.Contains("总排期", StringComparison.OrdinalIgnoreCase) || sheet.Equals("排期", StringComparison.OrdinalIgnoreCase);
    }

    private static readonly string[] PoHeaders = ["PO号", "PO", "订单PO.NO", "订单PONO", "现PO", "TOMYPO"];
    private static readonly string[] CustomerPoHeaders = ["CUSTOMERPO", "CUSTOMER PO", "CUST.PO NO.", "客户PO", "客户PO号", "客户/PO", "客PO"];
    private static readonly string[] ItemHeaders = ["货号", "ITEM#", "ITEM", "ITEMNO", "ITEMNUMBER", "ITEMCODE"];
    private static readonly string[] ProductHeaders = ["产品名称", "中文名", "中文名称", "货名", "名称"];
    private static readonly string[] CustomerHeaders = ["客户", "客名", "客户名称", "第三客户名称", "第三方客户名称", "客户名称（第三方客名）", "客户名称(第三方客名)"];
    private static readonly string[] QuantityHeaders = ["数量", "PO数量", "PO数量(PCS)", "订单数量"];
    private static readonly string[] InspectionDateHeaders = ["计划验货期", "验货期", "TMAX验货期", "客户验货期", "第三方QC验货期", "CEPIA验货期", "第三方验货期"];
    private static bool Has(Dictionary<string,int> map, string[] names) => names.Select(Normalize).Any(map.ContainsKey);
    private static Dictionary<string,int> Headers(IExcelDataReader r) => Enumerable.Range(0, Math.Min(r.FieldCount, 40)).Select(i => (n: Normalize(Text(r.GetValue(i))), i)).Where(x => x.n != "").GroupBy(x => x.n).ToDictionary(g => g.Key, g => g.First().i);
    private static bool IsSummary(string po, string customer, string item, string product) => string.IsNullOrWhiteSpace(item) && string.IsNullOrWhiteSpace(product) && (po.Contains("验货期") || po.Contains("月份") || customer.Contains("月份"));
    private static bool IsCompletedInspection(string value) => value.Trim().ToUpperInvariant() is "PASS" or "HOLD" or "REJ" or "AOD" or "不用验";
    private static string ResolveSite(string source, string workshop, string sheet)
    {
        if (source is "Toy Monster" or "JAZ/JWC") return "华登";
        if (source is "TOMY Indonesia" or "TIGERHEAD" or "ZANZOON") return "兴信";
        return (workshop + sheet) switch
    {
        var value when value.Contains("华登") => "华登",
        var value when value.Contains("湖南") || value.Contains("新邵") || value.Contains("邵阳") => "湖南",
        var value when value.Contains("兴信") || value.Contains("东莞") || value.Contains("A车间") || value.Contains("B车间") => "兴信",
        _ => "待分配",
    };
    }
    private static string Normalize(string v) => v.Replace(" ", "").Replace("\r", "").Replace("\n", "").Trim().ToUpperInvariant();
    private static string Text(object? v) => v is null or DBNull ? "" : v is DateTime d ? d.ToString("yyyy-MM-dd") : Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim() ?? "";
    private static decimal? Number(string v) => decimal.TryParse(v.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : null;
    private static DateTime? Date(string v) { if (double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) && n > 0) try { return DateTime.FromOADate(n).Date; } catch { return null; } return DateTime.TryParse(v, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.None, out var d) ? d.Date : null; }
    private static string Hash(string v) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(v)));

    private static Dictionary<string, Dictionary<int,string>> ReadRowColors(Stream stream)
    {
        var result = new Dictionary<string, Dictionary<int,string>>();
        try
        {
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read, true); if (zip.GetEntry("xl/styles.xml") is null) return result;
            XNamespace m="http://schemas.openxmlformats.org/spreadsheetml/2006/main", r="http://schemas.openxmlformats.org/officeDocument/2006/relationships", p="http://schemas.openxmlformats.org/package/2006/relationships";
            XDocument Load(string n) { using var s=zip.GetEntry(n)!.Open(); return XDocument.Load(s); }
            var styles=Load("xl/styles.xml"); var fonts=styles.Descendants(m+"fonts").Elements(m+"font").Select(f=>f.Element(m+"color")?.Attribute("rgb")?.Value).ToArray();
            var xfs=styles.Descendants(m+"cellXfs").Elements(m+"xf").Select(x=>(int?)x.Attribute("fontId")??0).ToArray();
            var wb=Load("xl/workbook.xml"); var rels=Load("xl/_rels/workbook.xml.rels").Descendants(p+"Relationship").ToDictionary(x=>(string)x.Attribute("Id")!,x=>(string)x.Attribute("Target")!);
            foreach(var sh in wb.Descendants(m+"sheet")) { var name=(string)sh.Attribute("name")!; var id=(string)sh.Attribute(r+"id")!; if(!rels.TryGetValue(id,out var target))continue; var entry=zip.GetEntry(target.StartsWith('/')?target.TrimStart('/'):("xl/"+target.Replace("../",""))); if(entry is null)continue; using var input=entry.Open(); var xml=XDocument.Load(input); var map=new Dictionary<int,string>();
                foreach(var row in xml.Descendants(m+"row")) { var counts=new Dictionary<string,int>(); foreach(var cell in row.Elements(m+"c").Take(30)) { var si=(int?)cell.Attribute("s")??0; if(si>=xfs.Length||xfs[si]>=fonts.Length)continue; var rgb=fonts[xfs[si]]; if(rgb is null||rgb.Length<6)continue; rgb=rgb[^6..]; var rr=Convert.ToInt32(rgb[..2],16);var gg=Convert.ToInt32(rgb[2..4],16);var bb=Convert.ToInt32(rgb[4..],16); string? detected=null; if(rr>180&&gg<100&&bb<100)detected="红色"; else if(rr>180&&bb>100&&gg<150)detected="粉色"; else if(bb>150&&bb>rr*1.2)detected="蓝色"; if(detected is not null)counts[detected]=counts.GetValueOrDefault(detected)+1; }
                    var dominant=counts.Where(x=>x.Value>=3).Select(x=>x.Key).ToArray(); if(int.TryParse((string?)row.Attribute("r"),out var number)&&dominant.Length>0)map[number]=dominant.Length>1?$"mixed:{string.Join('+',dominant)}":dominant[0] switch { "红色"=>"red", "粉色"=>"pink", _=>"blue" }; }
                result[name]=map; }
        } catch { }
        return result;
    }
}
