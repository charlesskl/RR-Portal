using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using ExcelDataReader;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public static class LegacyInspectionParser
{
    private static readonly HashSet<string> Sites = ["兴信", "湖南", "华登"];

    public static IReadOnlyList<InspectionRecord> Parse(Stream stream, string site, string fileName, string? template = null, List<LegacyImportIssue>? issues = null)
    {
        if (!Sites.Contains(site)) throw new InvalidDataException("厂区必须是兴信、湖南或华登");
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        using var reader = ExcelReaderFactory.CreateReader(stream);
        var dataSet = reader.AsDataSet(new ExcelDataSetConfiguration
        {
            ConfigureDataTable = _ => new ExcelDataTableConfiguration { UseHeaderRow = false },
        });
        var problems = issues ?? new List<LegacyImportIssue>();
        var records = new List<InspectionRecord>();
        foreach (DataTable sheet in dataSet.Tables)
        {
            if (!ShouldImportSheet(site, sheet.TableName, template)) continue;
            var headerRow = FindHeaderRow(sheet);
            if (headerRow < 0) continue;
            var headers = BuildHeaders(sheet.Rows[headerRow]);
            var jazHeaders = headers.ContainsKey("现PO号") || headers.ContainsKey("工作单号") || headers.ContainsKey("洋行名称");
            if (site == "华登" && (template == "JAZ专用") != jazHeaders) continue;
            for (var rowIndex = headerRow + 1; rowIndex < sheet.Rows.Count; rowIndex++)
            {
                var row = sheet.Rows[rowIndex];
                var problemCount = problems.Count;
                var record = MapRow(site, fileName, sheet.TableName, rowIndex + 1, headers, row, problems);
                if (record is not null && problemCount == problems.Count) records.Add(record);
            }
        }
        if (issues is null && problems.Count > 0) throw new InvalidDataException(string.Join("；", problems.Select(problem => $"{problem.Sheet} 第{problem.Row}行：{problem.Reason}")));
        if (records.Count == 0 && problems.Count == 0) throw new InvalidDataException($"没有在{site}模板中识别到可导入的验货记录");
        return records;
    }

    private static bool ShouldImportSheet(string site, string sheetName, string? template) => site switch
    {
        "兴信" => System.Text.RegularExpressions.Regex.IsMatch(sheetName, @"^\d+月份?$"),
        "华登" when template == "JAZ专用" => sheetName.Contains("JAZ", StringComparison.OrdinalIgnoreCase) || sheetName.Contains("DPI", StringComparison.OrdinalIgnoreCase),
        "华登" => !sheetName.Contains("DPI", StringComparison.OrdinalIgnoreCase) && !sheetName.Contains("JAZ", StringComparison.OrdinalIgnoreCase),
        "湖南" => sheetName == "验货总结汇总表",
        _ => false,
    };

    private static int FindHeaderRow(DataTable sheet)
    {
        for (var rowIndex = 0; rowIndex < Math.Min(sheet.Rows.Count, 10); rowIndex++)
        {
            var values = sheet.Rows[rowIndex].ItemArray.Select(value => NormalizeHeader(Text(value))).ToArray();
            var standard = values.Any(value => value == "日期") && values.Any(value => value == "货号");
            var jaz = values.Any(value => value == "现PO号") && values.Any(value => value == "货号") && values.Any(value => value == "第三方验货时间");
            if (standard || jaz) return rowIndex;
        }
        return -1;
    }

    private static Dictionary<string, int> BuildHeaders(DataRow row)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < row.ItemArray.Length; index++)
        {
            var header = NormalizeHeader(Text(row[index]));
            if (string.IsNullOrEmpty(header)) continue;
            if (!result.ContainsKey(header)) result[header] = index;
            else
            {
                var occurrence = 2;
                while (result.ContainsKey($"{header}#{occurrence}")) occurrence++;
                result[$"{header}#{occurrence}"] = index;
            }
        }
        return result;
    }

    private static InspectionRecord? MapRow(string site, string fileName, string sheetName, int sourceRow,
        Dictionary<string, int> headers, DataRow row, List<LegacyImportIssue> issues)
    {
        string Get(params string[] names)
        {
            foreach (var name in names)
                if (headers.TryGetValue(NormalizeHeader(name), out var index) && index < row.ItemArray.Length)
                    return Text(row[index]);
            return string.Empty;
        }

        var isJaz = headers.ContainsKey("现PO号") || headers.ContainsKey("工作单号") || headers.ContainsKey("洋行名称");
        var date = Date(Get("日期")) ?? EmbeddedMonthDay(Get("第三方验货时间"), fileName);
        var itemNumber = Get("货号");
        var contract = Get("合同编号", "工作单号", "现PO号");
        if (date is null && new[] { itemNumber, contract, Get("客户/PO", "客户PO", "现PO号"),
            Get("产品名称", "名称"), Get("数量"), Get("洋行结果", "结果"), Get("第三方结果") }.All(string.IsNullOrWhiteSpace)) return null;
        var note = Get("备注");
        var workshop = Get("生产车间", "生产地点");
        var supervisor = Get("责任主管", "生产主管");
        var record = new InspectionRecord
        {
            Site = site,
            InspectionTemplate = site == "华登" ? isJaz ? "JAZ专用" : "普通验货" : "",
            InspectionDate = date,
            InspectionLocation = Get("验货地点", "验货地址"),
            InspectionParty = site == "华登" ? Get("验货客户") : note,
            ThirdPartyOrganization = Get("第三方"),
            Customer = isJaz ? Get("洋行名称", "客户名称") is { Length: > 0 } name ? name : "JAZWARES" : Get("客户名称"),
            ContractNumber = contract,
            CustomerPo = Get("客户/PO", "客户PO", "现PO号"),
            ItemNumber = itemNumber,
            ProductName = Get("产品名称", "名称"),
            Quantity = Number(Get("数量")),
            Cartons = Number(Get("箱数", "总箱数")),
            SampledCartons = Number(Get("抽箱数")),
            SecondaryCartons = Number(Get("箱数#2")),
            InternalResult = Get("洋行结果", "结果", "验货结果"),
            ThirdPartyResult = Get("第三方结果"),
            HoldRejectReason = Get("HOLD/REJ原因", "原因描述"),
            ProductionWorkshop = workshop,
            ProductionSupervisor = ResolveProductionSupervisor(workshop, supervisor),
            ResponsibleLineLeader = Get("责任拉长"),
            ProblemSource = Get("问题源头"),
            HandlingResult = Get("处理结果"),
            TestScrap = Get("测试报废"),
            PackagingSpec = Get("包装"),
            PackingQuantity = Number(Get("装箱数")),
            ThirdPartyInspectionLocation = Get("验货地点#2"),
            Note = note,
            SourceFile = fileName,
            SourceSheet = sheetName,
            SourceRow = sourceRow,
        };
        // Missing columns preserve system values; present empty cells clear them.
        var columns = new Dictionary<string, string[]>
        {
            ["InspectionDate"] = ["日期", "第三方验货时间"],
            ["InspectionLocation"] = ["验货地点", "验货地址"],
            ["InspectionParty"] = site == "华登" ? ["验货客户"] : ["备注"],
            ["ThirdPartyOrganization"] = ["第三方"], ["Customer"] = ["客户名称", "洋行名称", "现PO号"],
            ["ContractNumber"] = ["合同编号", "工作单号", "现PO号"],
            ["CustomerPo"] = ["客户/PO", "客户PO", "现PO号"], ["ItemNumber"] = ["货号"],
            ["ProductName"] = ["产品名称", "名称"], ["Quantity"] = ["数量"],
            ["InspectedQuantity"] = ["实际验货数量", "本次实际验货数量", "实检数量"],
            ["Cartons"] = ["箱数", "总箱数"], ["InternalResult"] = ["洋行结果", "结果", "验货结果"],
            ["ThirdPartyResult"] = ["第三方结果"], ["HoldRejectReason"] = ["HOLD/REJ原因", "原因描述"],
            ["ProductionWorkshop"] = ["生产车间", "生产地点"], ["ProductionSupervisor"] = ["责任主管", "生产主管", "生产车间", "生产地点"],
            ["ResponsibleLineLeader"] = ["责任拉长"], ["ProblemSource"] = ["问题源头"],
            ["HandlingResult"] = ["处理结果"], ["TestScrap"] = ["测试报废"],
            ["PackagingSpec"] = ["包装"], ["PackingQuantity"] = ["装箱数"],
            ["ThirdPartyInspectionLocation"] = ["验货地点#2"], ["Note"] = ["备注"], ["SampledCartons"] = ["抽箱数"], ["SecondaryCartons"] = ["箱数#2"],
        };
        record.ImportFields = columns.Where(pair => pair.Value.Any(name => headers.ContainsKey(NormalizeHeader(name))))
            .Select(pair => pair.Key).ToHashSet();
        if (site == "华登") record.ImportFields.Add(nameof(record.InspectionTemplate));
        foreach (var field in new[] { "Quantity", "Cartons", "PackingQuantity", "InspectedQuantity", "SampledCartons", "SecondaryCartons" })
        {
            var value = Get(columns[field]);
            if (!string.IsNullOrWhiteSpace(value) && Number(value) is null)
                issues.Add(LegacyImportIssue.From(record, $"{columns[field][0]}格式无效：{value}"));
        }
        record.InspectedQuantity = Number(Get(columns["InspectedQuantity"]));
        if (record.Quantity is < 0 || record.Cartons is < 0 || record.PackingQuantity is < 0 ||
            record.InspectedQuantity is < 0 || record.InspectedQuantity > record.Quantity)
            issues.Add(LegacyImportIssue.From(record, "数量不能为负数，实检数量不能超过计划数量"));
        // Empty optional cells are legitimate in historical inspection sheets.
        // A supplied, unparseable date still needs correction; an absent date is accepted.
        var dateText = Get("日期");
        if (date is null && !string.IsNullOrWhiteSpace(dateText) && dateText is not ("-" or "—"))
            issues.Add(LegacyImportIssue.From(record, $"验货日期无法识别：{dateText}"));
        record.Fingerprint = LegacyInspectionImport.Fingerprint(record);
        return record;
    }

    private static string NormalizeHeader(string value) => value.Replace(" ", string.Empty)
        .Replace("\r", string.Empty).Replace("\n", string.Empty).Trim();

    private static string Text(object? value) => value is null or DBNull ? string.Empty : value switch
    {
        DateTime date => date.ToString("yyyy-MM-dd"),
        double number when Math.Abs(number % 1) < .0000001 => number.ToString("0", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? string.Empty,
    };

    private static DateTime? Date(string value)
    {
        value = System.Text.RegularExpressions.Regex.Replace(value.Trim(),
            @"\s*[（(](?:星期|周)?[一二三四五六日天][)）]\s*$", "");
        if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var serial) && serial > 0)
            try { return DateTime.FromOADate(serial).Date; } catch (ArgumentException) { return null; }
        return DateTime.TryParse(value, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.None, out var date) ? date.Date : null;
    }

    private static DateTime? EmbeddedMonthDay(string value, string fileName)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value, @"(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?!\d)");
        if (!match.Success) return null;
        var yearMatch = System.Text.RegularExpressions.Regex.Match(fileName, @"20\d{2}");
        var year = yearMatch.Success ? int.Parse(yearMatch.Value, CultureInfo.InvariantCulture) : DateTime.Today.Year;
        return int.TryParse(match.Groups[1].Value, out var month) && int.TryParse(match.Groups[2].Value, out var day)
            && month is >= 1 and <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year, month)
            ? new DateTime(year, month, day) : null;
    }

    private static decimal? Number(string value) => decimal.TryParse(value.Replace(",", string.Empty),
        NumberStyles.Any, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static string ResolveProductionSupervisor(string workshop, string supervisor)
    {
        if (!string.IsNullOrWhiteSpace(supervisor)) return supervisor;
        var mappings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["A车间"] = "张安源", ["B车间"] = "谭都", ["华登车间"] = "余小兵",
            ["新邵车间"] = "肖晔", ["湖南车间"] = "关芬乐",
        };
        return mappings.TryGetValue(workshop.Trim(), out var mapped) ? mapped : string.Empty;
    }
}
