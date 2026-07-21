using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using SprayPlan.Api.Features.Recording;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 导出 workbook 结构/样式合法性（防 OpenXML Stylesheet 顺序或 Fills 缺位导致 Excel/WPS 打不开）。
public class RecordingExportTests
{
    const int LineId = 7;
    static RecordingExport.ExportRow Row(string line) =>
        new(LineId, line, "胡旗", "移印", "2026-06-10", new() { "30#" }, "9296", "兔子头", 5000, 2, 11, 4000, 1000, 3800, "入库3800");

    static IReadOnlyDictionary<int, LineNote> Note(string? header, string? misc) =>
        new Dictionary<int, LineNote> { [LineId] = new LineNote(LineId, header, misc) };

    // 生成的 xlsx 能被 OpenXML 重新打开（结构合法）；Stylesheet 的 Fills 前两位为 None+Gray125。
    [Fact]
    public void ActualWorkbook_OpensCleanly_WithValidStylesheet()
    {
        var bytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "actual", new[] { Row("胡旗拉") }, Note("35人，实际29人", "杂工11人"));

        using var ms = new MemoryStream(bytes);
        using var doc = SpreadsheetDocument.Open(ms, false);   // 能打开 = 结构合法
        var styles = doc.WorkbookPart!.WorkbookStylesPart!.Stylesheet;
        var fills = styles.Fills!.Elements<Fill>().ToList();
        Assert.True(fills.Count >= 2);
        Assert.Equal(PatternValues.None, fills[0].PatternFill!.PatternType!.Value);
        Assert.Equal(PatternValues.Gray125, fills[1].PatternFill!.PatternType!.Value);
        // 至少一个 sheet
        Assert.NotEmpty(doc.WorkbookPart.Workbook.Sheets!.Elements<Sheet>());
    }

    // plan 版表头 10 列、actual 版 11 列（含「生产数」）。
    [Fact]
    public void HeaderColumnCount_DiffersByMode()
    {
        var planBytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "plan", new[] { Row("A拉") }, Note(null, null));
        var actualBytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "actual", new[] { Row("A拉") }, Note(null, null));

        Assert.Equal(10, HeaderCellCount(planBytes));
        Assert.Equal(11, HeaderCellCount(actualBytes));
    }

    static int HeaderCellCount(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var doc = SpreadsheetDocument.Open(ms, false);
        var ws = doc.WorkbookPart!.WorksheetParts.First().Worksheet;
        var row2 = ws.GetFirstChild<SheetData>()!.Elements<Row>().First(r => r.RowIndex == 2u);
        return row2.Elements<Cell>().Count();
    }
}
