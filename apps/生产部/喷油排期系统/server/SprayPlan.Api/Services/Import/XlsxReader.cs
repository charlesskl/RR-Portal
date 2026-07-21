using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;

namespace SprayPlan.Api.Services.Import;

// OpenXml 薄适配层：把 xlsx 流读成「sheet 名 → string?[][] 网格」。
// 处理共享字符串、内联字符串、数字；按单元格引用(A1/C3)还原行列，空格补 null。
public static class XlsxReader
{
    public static Dictionary<string, string?[][]> ToGrids(Stream stream)
    {
        var result = new Dictionary<string, string?[][]>();
        using var doc = SpreadsheetDocument.Open(stream, false);
        var wbPart = doc.WorkbookPart!;
        var sst = wbPart.SharedStringTablePart?.SharedStringTable;

        foreach (var sheet in wbPart.Workbook.Sheets!.Elements<Sheet>())
        {
            var wsPart = (WorksheetPart)wbPart.GetPartById(sheet.Id!);
            var rows = wsPart.Worksheet.GetFirstChild<SheetData>()?.Elements<Row>().ToList() ?? new();

            int maxRow = 0, maxCol = 0;
            var cellMap = new Dictionary<(int r, int c), string?>();
            foreach (var row in rows)
                foreach (var cell in row.Elements<Cell>())
                {
                    var (r, c) = RefToRowCol(cell.CellReference!);
                    cellMap[(r, c)] = CellText(cell, sst);
                    if (r > maxRow) maxRow = r;
                    if (c > maxCol) maxCol = c;
                }

            var grid = new string?[maxRow + 1][];
            for (int r = 0; r <= maxRow; r++)
            {
                grid[r] = new string?[maxCol + 1];
                for (int c = 0; c <= maxCol; c++)
                    grid[r][c] = cellMap.TryGetValue((r, c), out var v) ? v : null;
            }
            result[sheet.Name!.Value!] = grid;
        }
        return result;
    }

    static string? CellText(Cell cell, SharedStringTable? sst)
    {
        var raw = cell.CellValue?.InnerText;
        if (cell.DataType?.Value == CellValues.SharedString)
        {
            // 共享字符串：CellValue 存的是 SharedStringTable 的索引，需按索引取实际文本
            if (raw is null || sst is null) return null;
            if (!int.TryParse(raw, out var idx)) return null;
            var item = sst.Elements<SharedStringItem>().ElementAtOrDefault(idx);
            var text = item?.InnerText;
            return string.IsNullOrEmpty(text) ? null : text;
        }
        if (cell.DataType?.Value == CellValues.InlineString)
        {
            // 内联字符串：文本直接嵌在 <is><t> 节点内
            var text = cell.InlineString?.Text?.Text;
            return string.IsNullOrEmpty(text) ? null : text;
        }
        // 数字/日期/布尔等：直接返回 CellValue 原始文本
        return string.IsNullOrEmpty(raw) ? null : raw;
    }

    // 将单元格引用（如 "C3"）转换为 0 起的 (行, 列) 索引。
    // 字母部分 → 列（A=0, B=1, Z=25, AA=26 …），数字部分 → 行。
    static (int r, int c) RefToRowCol(string reference)
    {
        int i = 0; int col = 0;
        while (i < reference.Length && char.IsLetter(reference[i]))
        {
            col = col * 26 + (char.ToUpper(reference[i]) - 'A' + 1);
            i++;
        }
        int row = int.Parse(reference[i..]);
        return (row - 1, col - 1);
    }
}
