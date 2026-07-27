using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using SprayPlan.Api.Features.Recording;

namespace SprayPlan.Api.Services;

// 《每日生产明细表》xlsx：每条拉别一个 sheet，版式对齐车间手工日报。
public static class RecordingExport
{
    const int ColumnCount = 13;
    static readonly string[] Headers =
    {
        "生产日期", "机台号", "客名", "货号", "名称", "总订单数", "人数",
        "生产时间", "计划生产数", "余下订单数", "实际生产数", "吻合率", "备注"
    };

    public record ExportRow(int LineId, string LineName, string? LeaderName, string CraftType,
        string ProductionDate, List<string> MachineNos, string CustomerName,
        string ProductNo, string Name, int TotalDemand, int WorkerCount,
        double WorkHours, int PlannedQty, int RemainingQty, int ActualQty, string Remark);

    public static byte[] BuildDetailWorkbook(string date, string mode,
        IEnumerable<ExportRow> rows, IReadOnlyDictionary<int, LineNote> notes)
    {
        var rowList = rows.ToList();
        using var ms = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(ms, SpreadsheetDocumentType.Workbook))
        {
            var wbPart = doc.AddWorkbookPart();
            wbPart.Workbook = new Workbook();

            var stylesPart = wbPart.AddNewPart<WorkbookStylesPart>();
            stylesPart.Stylesheet = BuildStylesheet();
            stylesPart.Stylesheet.Save();

            var sheets = wbPart.Workbook.AppendChild(new Sheets());
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            uint sheetId = 1;

            if (rowList.Count == 0)
            {
                AddSheet(wbPart, sheets, sheetId, "日报表", date, mode, Array.Empty<ExportRow>(), null, usedNames);
            }
            else
            {
                foreach (var grp in rowList.GroupBy(r => r.LineId))
                {
                    notes.TryGetValue(grp.Key, out var note);
                    AddSheet(wbPart, sheets, sheetId++, grp.First().LineName, date, mode, grp, note, usedNames);
                }
            }

            wbPart.Workbook.Save();
        }
        return ms.ToArray();
    }

    static void AddSheet(WorkbookPart wbPart, Sheets sheets, uint sheetId, string requestedName,
        string date, string mode, IEnumerable<ExportRow> sourceRows, LineNote? note, HashSet<string> usedNames)
    {
        var rows = sourceRows.ToList();
        var first = rows.FirstOrDefault();
        var wsPart = wbPart.AddNewPart<WorksheetPart>();
        var sheetData = new SheetData();
        var merges = new MergeCells();

        var top = new Row { RowIndex = 1, Height = 30, CustomHeight = true };
        for (var c = 1; c <= ColumnCount; c++)
        {
            var value = c == 1 ? $"拉长：{first?.LeaderName ?? ""}"
                : c == 2 ? first?.CraftType ?? ""
                : c == 6 ? note?.HeaderText ?? "" : "";
            top.Append(TextCell($"{Col(c)}1", value, 2));
        }
        sheetData.Append(top);
        merges.Append(new MergeCell { Reference = "B1:E1" });
        merges.Append(new MergeCell { Reference = "F1:M1" });

        var header = new Row { RowIndex = 2, Height = 30, CustomHeight = true };
        for (var i = 0; i < Headers.Length; i++)
        {
            var style = i is 10 or 11 ? 3u : 2u;
            header.Append(TextCell($"{Col(i + 1)}2", Headers[i], style));
        }
        sheetData.Append(header);

        uint rowIndex = 3;
        for (var index = 0; index < rows.Count; index++)
        {
            var data = rows[index];
            var row = new Row { RowIndex = rowIndex, Height = 30, CustomHeight = true };
            row.Append(TextCell($"A{rowIndex}", index == 0 ? ChineseDate(data.ProductionDate) : "", 1));
            row.Append(TextCell($"B{rowIndex}", string.Join("、", data.MachineNos), 1));
            row.Append(TextCell($"C{rowIndex}", data.CustomerName, 1));
            row.Append(TextCell($"D{rowIndex}", data.ProductNo, 1));
            row.Append(TextCell($"E{rowIndex}", data.Name, 1));
            row.Append(NumCell($"F{rowIndex}", data.TotalDemand, 1));
            row.Append(NumCell($"G{rowIndex}", data.WorkerCount, 1));
            row.Append(NumCell($"H{rowIndex}", data.WorkHours, 1));
            row.Append(NumCell($"I{rowIndex}", data.PlannedQty, 1));
            row.Append(NumCell($"J{rowIndex}", data.RemainingQty, 1));
            if (mode == "actual") row.Append(NumCell($"K{rowIndex}", data.ActualQty, 1));
            else row.Append(TextCell($"K{rowIndex}", "", 1));
            var rate = mode == "actual" && data.PlannedQty > 0 ? (double)data.ActualQty / data.PlannedQty : 0;
            row.Append(FormulaCell($"L{rowIndex}", $"IFERROR(K{rowIndex}/I{rowIndex},0)", rate, 4));
            row.Append(TextCell($"M{rowIndex}", data.Remark, 1));
            sheetData.Append(row);
            rowIndex++;
        }

        if (rows.Count == 0)
        {
            var empty = new Row { RowIndex = rowIndex, Height = 30, CustomHeight = true };
            empty.Append(TextCell($"A{rowIndex}", ChineseDate(date), 1));
            for (var c = 2; c <= ColumnCount; c++) empty.Append(TextCell($"{Col(c)}{rowIndex}", "", c == 12 ? 4u : 1u));
            sheetData.Append(empty);
            rowIndex++;
        }

        var productionPeople = rows.Sum(r => r.WorkerCount);
        var summary = new Row { RowIndex = rowIndex, Height = 28, CustomHeight = true };
        for (var c = 1; c <= ColumnCount; c++)
        {
            if (c == 6) summary.Append(TextCell($"F{rowIndex}", "生产人数：", 2));
            else if (c == 7) summary.Append(NumCell($"G{rowIndex}", productionPeople, 2));
            else summary.Append(TextCell($"{Col(c)}{rowIndex}", "", 1));
        }
        sheetData.Append(summary);
        rowIndex++;

        var miscCount = Math.Max(0, note?.MiscCount ?? 0);
        var footer = new Row { RowIndex = rowIndex, Height = 32, CustomHeight = true };
        for (var c = 1; c <= ColumnCount; c++)
        {
            if (c == 1) footer.Append(TextCell($"A{rowIndex}", "备注：", 5));
            else if (c == 2) footer.Append(NumCell($"B{rowIndex}", miscCount, 5));
            else if (c == 3) footer.Append(TextCell($"C{rowIndex}", note?.MiscText ?? "", 5));
            else if (c == 13) footer.Append(NumCell($"M{rowIndex}", productionPeople + miscCount, 5));
            else footer.Append(TextCell($"{Col(c)}{rowIndex}", "", 5));
        }
        sheetData.Append(footer);
        merges.Append(new MergeCell { Reference = $"C{rowIndex}:L{rowIndex}" });

        var columns = new Columns(
            Width(1, 15), Width(2, 20), Width(3, 18), Width(4, 12), Width(5, 23),
            Width(6, 12), Width(7, 10), Width(8, 10), Width(9, 14), Width(10, 14),
            Width(11, 14), Width(12, 14), Width(13, 16));

        var worksheet = new Worksheet();
        worksheet.Append(new SheetViews(new SheetView
        {
            WorkbookViewId = 0,
            ShowGridLines = false,
            Pane = new Pane { VerticalSplit = 2, TopLeftCell = "A3", ActivePane = PaneValues.BottomLeft, State = PaneStateValues.Frozen }
        }));
        worksheet.Append(new SheetFormatProperties { DefaultRowHeight = 30 });
        worksheet.Append(columns);
        worksheet.Append(sheetData);
        worksheet.Append(merges);
        worksheet.Append(new PrintOptions { HorizontalCentered = true });
        worksheet.Append(new PageMargins { Left = 0.2, Right = 0.2, Top = 0.35, Bottom = 0.35, Header = 0.1, Footer = 0.1 });
        worksheet.Append(new PageSetup { Orientation = OrientationValues.Landscape, FitToWidth = 1, FitToHeight = 0, PaperSize = 9 });
        wsPart.Worksheet = worksheet;

        var sheetName = UniqueSheetName(requestedName, usedNames);
        sheets.Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = sheetId, Name = sheetName });

        var definedNames = wbPart.Workbook.DefinedNames ?? wbPart.Workbook.AppendChild(new DefinedNames());
        var localId = sheetId - 1;
        definedNames.Append(new DefinedName($"'{sheetName.Replace("'", "''")}'!$1:$2") { Name = "_xlnm.Print_Titles", LocalSheetId = localId });
        definedNames.Append(new DefinedName($"'{sheetName.Replace("'", "''")}'!$A$1:$M${rowIndex}") { Name = "_xlnm.Print_Area", LocalSheetId = localId });
    }

    static Stylesheet BuildStylesheet()
    {
        var normalFont = new Font(new FontSize { Val = 11 }, new FontName { Val = "宋体" });
        var boldFont = new Font(new Bold(), new FontSize { Val = 11 }, new FontName { Val = "宋体" });
        var redBoldFont = new Font(new Bold(), new FontSize { Val = 11 }, new Color { Rgb = "FFFF0000" }, new FontName { Val = "宋体" });
        var redFont = new Font(new FontSize { Val = 11 }, new Color { Rgb = "FFFF0000" }, new FontName { Val = "宋体" });
        var fonts = new Fonts(normalFont, boldFont, redBoldFont, redFont);
        var fills = new Fills(
            new Fill(new PatternFill { PatternType = PatternValues.None }),
            new Fill(new PatternFill { PatternType = PatternValues.Gray125 }),
            new Fill(new PatternFill(new ForegroundColor { Rgb = "FFFCD5B4" }) { PatternType = PatternValues.Solid }));
        var borders = new Borders(new Border(), ThinBorder());
        var formats = new CellFormats(
            new CellFormat(),
            Format(0, 0),
            Format(1, 0),
            Format(2, 0),
            Format(0, 10),
            Format(3, 0, 2));
        return new Stylesheet(
            new NumberingFormats(new NumberingFormat { NumberFormatId = 164, FormatCode = "0%" }),
            fonts, fills, borders, formats);
    }

    static CellFormat Format(uint fontId, uint numberFormatId, uint fillId = 0) => new()
    {
        FontId = fontId, FillId = fillId, BorderId = 1, NumberFormatId = numberFormatId == 10 ? 164u : numberFormatId,
        ApplyFont = true, ApplyFill = true, ApplyBorder = true, ApplyNumberFormat = numberFormatId != 0,
        Alignment = new Alignment { Horizontal = HorizontalAlignmentValues.Center, Vertical = VerticalAlignmentValues.Center, WrapText = true },
        ApplyAlignment = true
    };

    static Border ThinBorder() => new(
        new LeftBorder { Style = BorderStyleValues.Thin, Color = new Color { Rgb = "FF000000" } },
        new RightBorder { Style = BorderStyleValues.Thin, Color = new Color { Rgb = "FF000000" } },
        new TopBorder { Style = BorderStyleValues.Thin, Color = new Color { Rgb = "FF000000" } },
        new BottomBorder { Style = BorderStyleValues.Thin, Color = new Color { Rgb = "FF000000" } },
        new DiagonalBorder());

    static Column Width(uint index, double width) => new() { Min = index, Max = index, Width = width, CustomWidth = true };

    static Cell TextCell(string reference, string text, uint styleIndex)
    {
        var cell = new Cell { CellReference = reference, DataType = CellValues.InlineString, StyleIndex = styleIndex };
        cell.Append(new InlineString(new Text(text ?? "")));
        return cell;
    }

    static Cell NumCell(string reference, double value, uint styleIndex) => new()
    {
        CellReference = reference,
        CellValue = new CellValue(value.ToString(CultureInfo.InvariantCulture)),
        DataType = CellValues.Number,
        StyleIndex = styleIndex
    };

    static Cell FormulaCell(string reference, string formula, double cachedValue, uint styleIndex) => new()
    {
        CellReference = reference,
        CellFormula = new CellFormula(formula),
        CellValue = new CellValue(cachedValue.ToString(CultureInfo.InvariantCulture)),
        StyleIndex = styleIndex
    };

    static string Col(int col)
    {
        var name = "";
        while (col > 0) { col--; name = (char)('A' + col % 26) + name; col /= 26; }
        return name;
    }

    static string ChineseDate(string ymd)
        => DateTime.TryParseExact(ymd, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? $"{date.Year}年{date.Month}月{date.Day}日"
            : ymd;

    static string UniqueSheetName(string requested, HashSet<string> used)
    {
        var clean = string.IsNullOrWhiteSpace(requested) ? "Sheet" : requested;
        foreach (var ch in new[] { '\\', '/', '?', '*', '[', ']', ':' }) clean = clean.Replace(ch, '_');
        clean = clean.Length > 31 ? clean[..31] : clean;
        var candidate = clean;
        var suffix = 2;
        while (!used.Add(candidate))
        {
            var tail = $"-{suffix++}";
            candidate = clean[..Math.Min(clean.Length, 31 - tail.Length)] + tail;
        }
        return candidate;
    }
}
