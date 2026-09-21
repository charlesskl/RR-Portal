using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public static class InspectionExportService
{
    private sealed record ExportColumn(string Header, Func<InspectionRecord, object?> Value, double Width = 14);

    public static byte[] Create(IReadOnlyList<InspectionRecord> records, string site, string template)
    {
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbookPart = document.AddWorkbookPart();
            workbookPart.Workbook = new Workbook();
            var stylesPart = workbookPart.AddNewPart<WorkbookStylesPart>();
            stylesPart.Stylesheet = Styles();
            stylesPart.Stylesheet.Save();
            var sheets = workbookPart.Workbook.AppendChild(new Sheets());

            var groups = Groups(records, site, template).ToArray();
            if (groups.Length == 0) groups = [(DefaultSheetName(site, template), Array.Empty<InspectionRecord>())];
            uint sheetId = 1;
            foreach (var (name, rows) in groups)
                AddSheet(workbookPart, sheets, sheetId++, name, site, template, rows);
            workbookPart.Workbook.Save();
        }
        return stream.ToArray();
    }

    private static IEnumerable<(string Name, IReadOnlyList<InspectionRecord> Rows)> Groups(
        IReadOnlyList<InspectionRecord> records, string site, string template)
    {
        if (site == "湖南" || template == "JAZ专用")
        {
            yield return (DefaultSheetName(site, template), records);
            yield break;
        }
        foreach (var group in records.GroupBy(value => value.InspectionDate?.ToString("yyyy-MM") ?? "未定日期")
                     .OrderBy(value => value.Key))
        {
            var monthName = DateTime.TryParseExact(group.Key, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var month)
                ? site == "兴信" ? $"{month.Month}月份" : $"{month.Month}月"
                : group.Key;
            yield return (monthName, group.OrderBy(value => value.InspectionDate).ThenBy(value => value.Id).ToArray());
        }
    }

    private static string DefaultSheetName(string site, string template) => template == "JAZ专用"
        ? "JAZ验货排期" : site == "湖南" ? "验货总结汇总表" : "验货汇总";

    private static void AddSheet(WorkbookPart workbookPart, Sheets sheets, uint sheetId, string rawName,
        string site, string template, IReadOnlyList<InspectionRecord> records)
    {
        var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
        var columns = ColumnsFor(site, template);
        var data = new SheetData();
        var worksheet = new Worksheet();
        worksheet.Append(new SheetViews(new SheetView(new Pane
        {
            VerticalSplit = site == "湖南" ? 3 : 2, TopLeftCell = site == "湖南" ? "A4" : "A3",
            ActivePane = PaneValues.BottomLeft, State = PaneStateValues.Frozen,
        }) { WorkbookViewId = 0 }));
        worksheet.Append(new Columns(columns.Select((column, index) => new Column
        {
            Min = (uint)index + 1, Max = (uint)index + 1, Width = column.Width, CustomWidth = true,
        })));
        worksheet.Append(data);
        worksheetPart.Worksheet = worksheet;

        var title = template == "JAZ专用" ? "JAZWARES验货排期" : $"{site}每日验货总结表";
        data.Append(RowOf([TextCell(title, 1)], 28));
        var headerRowNumber = 2u;
        if (site == "湖南")
        {
            data.Append(RowOf([TextCell("备注：导出数据以系统当前筛选条件为准。", 2)], 22));
            headerRowNumber = 3;
        }
        data.Append(RowOf(columns.Select(column => TextCell(column.Header, 2)), 28));

        uint rowNumber = headerRowNumber + 1;
        var sequence = 1;
        foreach (var record in records)
        {
            var cells = new List<Cell>();
            for (var index = 0; index < columns.Length; index++)
            {
                object? value = template == "JAZ专用" && index == 0 ? sequence : columns[index].Value(record);
                if (template == "JAZ专用" && index == 6 && record.Quantity is not null && record.PackingQuantity is > 0)
                    cells.Add(FormulaCell($"ROUNDUP(E{rowNumber}/F{rowNumber},0)"));
                else cells.Add(ValueCell(value));
            }
            data.Append(RowOf(cells, 24));
            sequence++; rowNumber++;
        }

        var lastColumn = ColumnName(columns.Length);
        worksheet.Append(new AutoFilter { Reference = $"A{headerRowNumber}:{lastColumn}{Math.Max(headerRowNumber, rowNumber - 1)}" });
        worksheet.Append(new MergeCells(new MergeCell { Reference = $"A1:{lastColumn}1" }));
        worksheetPart.Worksheet.Save();
        sheets.Append(new Sheet { Id = workbookPart.GetIdOfPart(worksheetPart), SheetId = sheetId, Name = SafeSheetName(rawName) });
    }

    private static ExportColumn[] ColumnsFor(string site, string template)
    {
        if (template == "JAZ专用") return
        [
            new("序号", _ => null, 8), new("现PO号", r => string.IsNullOrWhiteSpace(r.CustomerPo) ? r.ContractNumber : r.CustomerPo, 22),
            new("货号", r => r.ItemNumber, 18), new("名称", r => r.ProductName, 32), new("数量", r => r.Quantity, 12),
            new("装箱数", r => r.PackingQuantity, 12), new("总箱数", r => r.Cartons, 12),
            new("第三方验货时间", r => r.InspectionDate, 20), new("包装", r => r.PackagingSpec, 35), new("备注", r => r.Note, 35),
        ];
        if (site == "湖南") return
        [
            new("日期", r => r.InspectionDate), new("验货地址", r => r.InspectionLocation), new("客户名称", r => r.Customer),
            new("合同编号", r => r.ContractNumber, 18), new("客户/PO", r => r.CustomerPo, 18), new("货号", r => r.ItemNumber, 20),
            new("产品名称", r => r.ProductName, 32), new("数量", r => r.Quantity), new("箱数", r => r.Cartons),
            new("结果", r => string.IsNullOrWhiteSpace(r.InternalResult) ? r.ThirdPartyResult : r.InternalResult),
            new("HOLD/REJ原因", r => r.HoldRejectReason, 30), new("验货客QC", r => r.InspectionParty),
            new("责任主管", r => r.ProductionSupervisor), new("责任拉长", r => r.ResponsibleLineLeader),
            new("问题源头", r => r.ProblemSource, 20), new("处理结果", r => r.HandlingResult, 20), new("备注", r => r.Note, 25),
        ];
        if (site == "华登") return
        [
            new("日期", r => r.InspectionDate), new("验货客户", r => r.InspectionParty), new("客户名称", r => r.Customer),
            new("合同编号", r => r.ContractNumber, 18), new("客户/PO", r => r.CustomerPo, 18), new("货号", r => r.ItemNumber, 20),
            new("产品名称", r => r.ProductName, 34), new("数量", r => r.Quantity), new("箱数", r => r.Cartons),
            new("洋行 结果", r => r.InternalResult), new("验货地点", r => r.InspectionLocation), new("第三方结果", r => r.ThirdPartyResult),
            new("验货地点", r => r.ThirdPartyInspectionLocation), new("HOLD/REJ 原因", r => r.HoldRejectReason, 30),
            new("生产车间", r => r.ProductionWorkshop), new("责任主管", r => r.ProductionSupervisor),
            new("责任拉长", r => r.ResponsibleLineLeader), new("箱数", r => r.Cartons), new("测试报废", r => r.TestScrap),
        ];
        return
        [
            new("日期", r => r.InspectionDate), new("验货地点", r => r.InspectionLocation), new("客户名称", r => r.Customer),
            new("第三方", r => r.ThirdPartyOrganization), new("合同编号", r => r.ContractNumber, 18), new("客户/PO", r => r.CustomerPo, 18),
            new("货号", r => r.ItemNumber, 20), new("产品名称", r => r.ProductName, 34), new("数量", r => r.Quantity),
            new("箱数", r => r.Cartons), new("洋行 结果", r => r.InternalResult), new("第三方结果", r => r.ThirdPartyResult),
            new("HOLD/REJ 原因", r => r.HoldRejectReason, 30), new("跟进车间", r => r.InspectionParty),
            new("生产车间", r => r.ProductionWorkshop), new("责任主管", r => r.ProductionSupervisor), new("备注", r => r.Note, 25),
        ];
    }

    private static Row RowOf(IEnumerable<Cell> cells, double height) => new(cells) { Height = height, CustomHeight = true };
    private static Cell ValueCell(object? value) => value switch
    {
        null => TextCell(string.Empty),
        DateTime date => new Cell { CellValue = new CellValue(date.ToOADate()), DataType = CellValues.Number, StyleIndex = 3 },
        decimal number => new Cell { CellValue = new CellValue(number), DataType = CellValues.Number, StyleIndex = 4 },
        _ => TextCell(Convert.ToString(value) ?? string.Empty),
    };
    private static Cell TextCell(string value, uint style = 5) => new() { InlineString = new InlineString(new Text(value)), DataType = CellValues.InlineString, StyleIndex = style };
    private static Cell FormulaCell(string formula) => new() { CellFormula = new CellFormula(formula), StyleIndex = 4 };

    private static Stylesheet Styles() => new(
        new Fonts(new Font(), new Font(new Bold(), new FontSize { Val = 16 }), new Font(new Bold())),
        new Fills(new Fill(new PatternFill { PatternType = PatternValues.None }), new Fill(new PatternFill { PatternType = PatternValues.Gray125 }),
            new Fill(new PatternFill(new ForegroundColor { Rgb = "FFEAF0FB" }) { PatternType = PatternValues.Solid })),
        new Borders(new Border(), new Border(new LeftBorder { Style = BorderStyleValues.Thin }, new RightBorder { Style = BorderStyleValues.Thin },
            new TopBorder { Style = BorderStyleValues.Thin }, new BottomBorder { Style = BorderStyleValues.Thin })),
        new CellFormats(new CellFormat(),
            new CellFormat { FontId = 1, Alignment = new Alignment { Horizontal = HorizontalAlignmentValues.Center, Vertical = VerticalAlignmentValues.Center } },
            new CellFormat { FontId = 2, FillId = 2, BorderId = 1, Alignment = new Alignment { Horizontal = HorizontalAlignmentValues.Center, Vertical = VerticalAlignmentValues.Center, WrapText = true } },
            new CellFormat { NumberFormatId = 14, BorderId = 1, Alignment = new Alignment { Horizontal = HorizontalAlignmentValues.Center } },
            new CellFormat { NumberFormatId = 3, BorderId = 1 },
            new CellFormat { BorderId = 1, Alignment = new Alignment { Vertical = VerticalAlignmentValues.Center, WrapText = true } }));

    private static string ColumnName(int number)
    {
        var result = string.Empty;
        while (number > 0) { number--; result = (char)('A' + number % 26) + result; number /= 26; }
        return result;
    }
    private static string SafeSheetName(string value)
    {
        foreach (var invalid in new[] { '[', ']', ':', '*', '?', '/', '\\' }) value = value.Replace(invalid, '-');
        return value.Length > 31 ? value[..31] : value;
    }
}
