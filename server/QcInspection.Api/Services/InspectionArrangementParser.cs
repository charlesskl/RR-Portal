using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using ExcelDataReader;

namespace QcInspection.Api.Services;

public static class InspectionArrangementParser
{
    public static ZuruParseResult Parse(Stream stream, string source)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        using var reader = ExcelReaderFactory.CreateReader(stream);
        var rows = new List<ZuruScheduleRow>();
        var skippedSheets = 0; var recognizedSheets = 0; var invalid = 0; var skippedRows = 0;
        do
        {
            var isZuru = source == "ZURU";
            var include = isZuru ? reader.Name.StartsWith("下周验货申请", StringComparison.OrdinalIgnoreCase) || reader.Name.Contains("含上周未验", StringComparison.OrdinalIgnoreCase)
                : reader.Name.Contains("未来三周", StringComparison.OrdinalIgnoreCase);
            if (!include) { skippedSheets++; continue; }
            recognizedSheets++;
            var rowNumber = 0;
            while (reader.Read())
            {
                rowNumber++;
                if (rowNumber <= (isZuru ? 4 : 2)) continue;
                string Get(int column) => column < reader.FieldCount ? Text(reader.GetValue(column)) : "";
                var po = Get(isZuru ? 3 : 4);
                var customerPo = Get(isZuru ? 4 : 3);
                var item = Get(isZuru ? 6 : 5);
                var customer = Get(1);
                if (string.IsNullOrWhiteSpace(po) && string.IsNullOrWhiteSpace(item)) continue;
                var location = Get(isZuru ? 22 : 14);
                if (!isZuru && location.Contains("已验货")) { skippedRows++; continue; }
                var date = isZuru ? Date(Get(16)) ?? Date(Get(14)) : Date(Get(10)) ?? Date(Get(9));
                var issues = new List<string>();
                if (string.IsNullOrWhiteSpace(po)) issues.Add("PO号为空，请核对列映射");
                if (string.IsNullOrWhiteSpace(item)) issues.Add("货号为空，请核对列映射");
                if (date is null) issues.Add("验货日期为空或格式异常");
                if (isZuru && reader.Name.Contains("含上周未验", StringComparison.OrdinalIgnoreCase) &&
                    date < DateTime.Today.AddDays(-14)) issues.Add("历史结转验货日期较早，请人工判断是否仍需验货");
                if (string.IsNullOrWhiteSpace(location)) issues.Add("验货地点为空");
                var quantity = Number(Get(isZuru ? 8 : 8));
                if (quantity is null) issues.Add("数量为空或格式异常");
                var key = Hash(string.Join('|', Normalize(source), Normalize(po), Normalize(customerPo), Normalize(item)));
                var site = location.Contains("湖南") || location.Contains("邵阳") || location.Contains("新邵") ? "湖南"
                    : location.Contains("东莞") || location.Contains("兴信") ? "兴信"
                    : location.Contains("华登") ? "华登" : "待分配";
                rows.Add(new ZuruScheduleRow(key, customer, Get(2), po, customerPo, item,
                    isZuru ? Get(7) : Get(6), quantity, null, null, date, null, "", site,
                    isZuru ? Get(23) : "", reader.Name, rowNumber, issues.ToArray(), location));
            }
        } while (reader.NextResult());
        // A repeated order/item may represent a separate inspection booking. Never discard it silently.
        return new(rows.GroupBy(row => row.BusinessKey).SelectMany(group => group.Count() == 1 || group.All(row =>
            row.PlannedInspectionDate == group.First().PlannedInspectionDate && row.Quantity == group.First().Quantity &&
            row.InspectionLocation == group.First().InspectionLocation) ? group.Take(1) : group.Select(row => row with
        {
            BusinessKey = Hash($"{row.BusinessKey}|{row.Sheet}|{row.Row}"),
            Issues = row.Issues.Append("同一订单货号重复安排，需单独核对").ToArray()
        })).ToArray(), skippedRows, invalid, skippedSheets, recognizedSheets);
    }

    private static string Text(object? value) => value is null or DBNull ? "" : value is DateTime date
        ? date.ToString("yyyy-MM-dd") : Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? "";
    private static decimal? Number(string value) => decimal.TryParse(value.Replace(",", ""), NumberStyles.Any,
        CultureInfo.InvariantCulture, out var result) ? result : null;
    private static DateTime? Date(string value)
    {
        if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var number) && number > 0)
            try { return DateTime.FromOADate(number).Date; } catch { return null; }
        return DateTime.TryParse(value, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.None, out var date) ? date.Date : null;
    }
    private static string Normalize(string value) => value.Replace(" ", "").Trim().ToUpperInvariant();
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
