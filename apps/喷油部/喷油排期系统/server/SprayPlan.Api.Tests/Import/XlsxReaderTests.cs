using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using SprayPlan.Api.Services.Import;
using Xunit;

namespace SprayPlan.Api.Tests.Import;

public class XlsxReaderTests
{
    // 用 OpenXML 造一个最小工作簿：1 个 sheet「S1」，含共享字符串单元格 + 数字单元格 + 跳列。
    static byte[] BuildWorkbook()
    {
        using var ms = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(ms, SpreadsheetDocumentType.Workbook))
        {
            var wbPart = doc.AddWorkbookPart();
            wbPart.Workbook = new Workbook();
            var sstPart = wbPart.AddNewPart<SharedStringTablePart>();
            sstPart.SharedStringTable = new SharedStringTable(
                new SharedStringItem(new Text("货名")),   // index 0
                new SharedStringItem(new Text("右身")));   // index 1
            sstPart.SharedStringTable.Save();

            var wsPart = wbPart.AddNewPart<WorksheetPart>();
            var data = new SheetData();
            // 第1行：A1=共享串"货名"(t=s,0)，C1=数字 99（跳过 B 列）
            var row1 = new Row { RowIndex = 1 };
            row1.Append(new Cell { CellReference = "A1", DataType = CellValues.SharedString, CellValue = new CellValue("0") });
            row1.Append(new Cell { CellReference = "C1", CellValue = new CellValue("99") });
            data.Append(row1);
            // 第2行：A2=共享串"右身"(t=s,1)
            var row2 = new Row { RowIndex = 2 };
            row2.Append(new Cell { CellReference = "A2", DataType = CellValues.SharedString, CellValue = new CellValue("1") });
            data.Append(row2);
            wsPart.Worksheet = new Worksheet(data);

            var sheets = wbPart.Workbook.AppendChild(new Sheets());
            sheets.Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = 1, Name = "S1" });
            wbPart.Workbook.Save();
        }
        return ms.ToArray();
    }

    [Fact]
    public void ReadsSharedStrings_Numbers_AndColumnGaps()
    {
        using var ms = new MemoryStream(BuildWorkbook());
        var grids = XlsxReader.ToGrids(ms);

        Assert.True(grids.ContainsKey("S1"));
        var g = grids["S1"];
        Assert.Equal("货名", g[0][0]);   // A1 共享串解出文本
        Assert.Null(g[0][1]);            // B1 空
        Assert.Equal("99", g[0][2]);     // C1 数字按文本
        Assert.Equal("右身", g[1][0]);   // A2 共享串
    }
}
