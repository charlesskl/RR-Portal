using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Validation;
using SprayPlan.Api.Features.Recording;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 导出 workbook 结构/样式合法性（防 OpenXML Stylesheet 顺序或 Fills 缺位导致 Excel/WPS 打不开）。
public class RecordingExportTests
{
    const int LineId = 7;
    static RecordingExport.ExportRow Row(string line) =>
        new(LineId, line, "胡旗", "移印", "2026-06-10", new() { "30#" }, "ZURU", "9296", "兔子头", 5000, 2, 11, 4000, 1000, 4200, "入库4000");

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
        var validationErrors = new OpenXmlValidator().Validate(doc).ToList();
        Assert.True(validationErrors.Count == 0,
            string.Join(Environment.NewLine, validationErrors.Select(e => $"{e.Part?.Uri} {e.Path?.XPath}: {e.Description}")));
    }

    // 计划版与实际版都按车间模板保持 13 列，避免打印版式跳动。
    [Fact]
    public void HeaderColumnCount_DiffersByMode()
    {
        var planBytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "plan", new[] { Row("A拉") }, Note(null, null));
        var actualBytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "actual", new[] { Row("A拉") }, Note(null, null));

        Assert.Equal(13, HeaderCellCount(planBytes));
        Assert.Equal(13, HeaderCellCount(actualBytes));
    }

    [Fact]
    public void Workbook_MatchesDailyReportStructureAndFormatting()
    {
        var bytes = RecordingExport.BuildDetailWorkbook(
            "2026-06-10", "actual", new[] { Row("胡旗拉") },
            new Dictionary<int, LineNote> { [LineId] = new(LineId, "40人，实际30人", "做板2人，杂工1人", 10) });
        using var ms = new MemoryStream(bytes);
        using var doc = SpreadsheetDocument.Open(ms, false);
        var ws = doc.WorkbookPart!.WorksheetParts.First().Worksheet;
        var data = ws.GetFirstChild<SheetData>()!;
        Assert.Contains(ws.Elements<MergeCells>().Single().Elements<MergeCell>(), m => m.Reference == "B1:E1");
        Assert.Contains(ws.Elements<MergeCells>().Single().Elements<MergeCell>(), m => m.Reference == "F1:M1");
        Assert.Equal(13, ws.Elements<Columns>().Single().Elements<Column>().Count());
        var header = data.Elements<Row>().Single(r => r.RowIndex == 2u);
        Assert.Equal("客名", CellText(header, "C2"));
        Assert.Equal("实际生产数", CellText(header, "K2"));
        Assert.Equal("吻合率", CellText(header, "L2"));
        var dataRow = data.Elements<Row>().Single(r => r.RowIndex == 3u);
        Assert.Equal("IFERROR(K3/I3,0)", dataRow.Elements<Cell>().Single(c => c.CellReference == "L3").CellFormula!.Text);
        var footer = data.Elements<Row>().Last();
        Assert.Equal("10", footer.Elements<Cell>().Single(c => c.CellReference == $"B{footer.RowIndex}").CellValue!.Text);
        Assert.Equal("12", footer.Elements<Cell>().Single(c => c.CellReference == $"M{footer.RowIndex}").CellValue!.Text);
    }

    [Fact]
    public void EmptyDay_StillContainsAValidWorksheet()
    {
        var bytes = RecordingExport.BuildDetailWorkbook("2026-06-10", "plan", Array.Empty<RecordingExport.ExportRow>(), new Dictionary<int, LineNote>());
        using var ms = new MemoryStream(bytes);
        using var doc = SpreadsheetDocument.Open(ms, false);
        Assert.Single(doc.WorkbookPart!.Workbook.Sheets!.Elements<Sheet>());
    }

    static int HeaderCellCount(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var doc = SpreadsheetDocument.Open(ms, false);
        var ws = doc.WorkbookPart!.WorksheetParts.First().Worksheet;
        var row2 = ws.GetFirstChild<SheetData>()!.Elements<Row>().First(r => r.RowIndex == 2u);
        return row2.Elements<Cell>().Count();
    }

    static string CellText(Row row, string cellRef)
        => row.Elements<Cell>().Single(c => c.CellReference == cellRef).InlineString!.Text!.Text;
}
