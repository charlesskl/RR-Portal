using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using SprayPlan.Api.Features.Recording;

namespace SprayPlan.Api.Services;

// 《每日生产明细表》xlsx 导出（每拉一个 sheet）—— 用微软官方 OpenXML SDK（被 Smart App Control 信任）。
// 抬头/表尾对照车间手工表（拉长｜工艺｜人数标签｜人数说明文字；备注标签｜杂工合计｜杂工明细文字｜上班人数）。
// 两副面孔：plan(计划版,不含生产数) / actual(实际版,含生产数=累计入库)。
// 文字(人数说明/杂工明细)由导出弹窗按 lineId 手填；数字(杂工合计/上班人数)第一批留空、第二批自动算。
// 样式本批只做：框线+居中+合并；颜色等上云再做。
public static class RecordingExport
{
    public record ExportRow(int LineId, string LineName, string? LeaderName, string CraftType,
        string ProductionDate, List<string> MachineNos,
        string ProductNo, string Name, int TotalDemand, int WorkerCount,
        double WorkHours, int PlannedQty, int RemainingQty, int ProducedQty, string Remark);

    // 按 mode 取数据表头：actual 在「计划生产数」后插「生产数」
    static string[] HeadersFor(string mode) => mode == "actual"
        ? new[] { "生产日期", "机台号", "货号", "名称", "总订单数", "人数", "生产时间", "计划生产数", "生产数", "余下订单数", "备注" }
        : new[] { "生产日期", "机台号", "货号", "名称", "总订单数", "人数", "生产时间", "计划生产数", "余下订单数", "备注" };

    public static byte[] BuildDetailWorkbook(string date, string mode,
        IEnumerable<ExportRow> rows, IReadOnlyDictionary<int, LineNote> notes)
    {
        var headers = HeadersFor(mode);
        int n = headers.Length;
        bool actual = mode == "actual";

        using var ms = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(ms, SpreadsheetDocumentType.Workbook))
        {
            var wbPart = doc.AddWorkbookPart();
            wbPart.Workbook = new Workbook();

            var stylesPart = wbPart.AddNewPart<WorkbookStylesPart>();
            stylesPart.Stylesheet = BuildStylesheet();
            stylesPart.Stylesheet.Save();

            var sheets = wbPart.Workbook.AppendChild(new Sheets());
            uint sheetId = 1;

            foreach (var grp in rows.GroupBy(r => r.LineId))
            {
                var first = grp.First();
                notes.TryGetValue(grp.Key, out var note);
                var wsPart = wbPart.AddNewPart<WorksheetPart>();
                var sheetData = new SheetData();
                var merges = new MergeCells();

                // ── 第1行：结构化抬头（4 区块对照手工表）──
                // 拉长：{leader} | {craftType} | 人数 | {人数说明文字·手填}
                // 列分配（共 n 列）：A=拉长；B..(分到工艺)；中段=人数标签；尾段=人数说明（合并到末列）
                var headerInfoRow = new Row { RowIndex = 1 };
                headerInfoRow.Append(TextCell("A1", $"拉长：{first.LeaderName ?? ""}"));
                headerInfoRow.Append(TextCell("B1", first.CraftType));
                headerInfoRow.Append(TextCell("C1", "人数"));
                headerInfoRow.Append(TextCell("D1", note?.HeaderText ?? ""));
                sheetData.Append(headerInfoRow);
                // 人数说明文字从 D 合并到末列
                if (n > 4) merges.Append(new MergeCell { Reference = $"D1:{Col(n)}1" });

                // ── 第2行：数据表头 ──
                var headRow = new Row { RowIndex = 2 };
                for (int i = 0; i < n; i++) headRow.Append(TextCell($"{Col(i + 1)}2", headers[i]));
                sheetData.Append(headRow);

                // ── 第3行起：数据 ──
                uint r = 3;
                foreach (var d in grp)
                {
                    var row = new Row { RowIndex = r };
                    int c = 1;
                    row.Append(TextCell($"{Col(c++)}{r}", d.ProductionDate));
                    row.Append(TextCell($"{Col(c++)}{r}", string.Join("、", d.MachineNos)));
                    row.Append(TextCell($"{Col(c++)}{r}", d.ProductNo));
                    row.Append(TextCell($"{Col(c++)}{r}", d.Name));
                    row.Append(NumCell($"{Col(c++)}{r}", d.TotalDemand));
                    row.Append(NumCell($"{Col(c++)}{r}", d.WorkerCount));
                    row.Append(NumCell($"{Col(c++)}{r}", d.WorkHours));
                    row.Append(NumCell($"{Col(c++)}{r}", d.PlannedQty));
                    if (actual) row.Append(NumCell($"{Col(c++)}{r}", d.ProducedQty));
                    row.Append(NumCell($"{Col(c++)}{r}", d.RemainingQty));
                    row.Append(TextCell($"{Col(c++)}{r}", d.Remark));
                    sheetData.Append(row);
                    r++;
                }

                // ── 末行：结构化表尾（对照手工表）──
                // 备注： | {杂工合计·第一批空} | {杂工明细文字·手填} | {上班人数·第一批空}
                var footRow = new Row { RowIndex = r };
                footRow.Append(TextCell($"A{r}", "备注："));
                footRow.Append(TextCell($"B{r}", ""));                       // 杂工合计（第一批留空）
                footRow.Append(TextCell($"C{r}", note?.MiscText ?? ""));     // 杂工明细文字
                if (n > 3)
                {
                    footRow.Append(TextCell($"{Col(n)}{r}", ""));           // 上班人数（第一批留空）
                    // 杂工明细从 C 合并到倒数第二列（末列留给上班人数）
                    if (n - 1 > 3) merges.Append(new MergeCell { Reference = $"C{r}:{Col(n - 1)}{r}" });
                }
                sheetData.Append(footRow);

                var ws = new Worksheet();
                ws.Append(sheetData);
                if (merges.HasChildren) ws.Append(merges);
                wsPart.Worksheet = ws;

                sheets.Append(new Sheet { Id = wbPart.GetIdOfPart(wsPart), SheetId = sheetId, Name = SafeSheetName(first.LineName) });
                sheetId++;
            }
            wbPart.Workbook.Save();
        }
        return ms.ToArray();
    }

    // 样式表：CellFormats[0]=默认；CellFormats[1]=居中+四边 thin 框线
    static Stylesheet BuildStylesheet()
    {
        var borders = new Borders(
            new Border(),
            new Border(
                new LeftBorder { Style = BorderStyleValues.Thin },
                new RightBorder { Style = BorderStyleValues.Thin },
                new TopBorder { Style = BorderStyleValues.Thin },
                new BottomBorder { Style = BorderStyleValues.Thin },
                new DiagonalBorder())
        );
        var fonts = new Fonts(new Font());
        // OpenXML 规范(ECMA-376)强制：Fills 前两位必须是 None + Gray125，否则 Excel/WPS 打开报错
        var fills = new Fills(
            new Fill(new PatternFill { PatternType = PatternValues.None }),
            new Fill(new PatternFill { PatternType = PatternValues.Gray125 }));
        var cellFormats = new CellFormats(
            new CellFormat(),
            new CellFormat
            {
                BorderId = 1, ApplyBorder = true,
                Alignment = new Alignment { Horizontal = HorizontalAlignmentValues.Center, Vertical = VerticalAlignmentValues.Center },
                ApplyAlignment = true,
            }
        );
        return new Stylesheet(fonts, fills, borders, cellFormats);
    }

    static Cell TextCell(string reference, string text, uint styleIndex = 1)
    {
        var c = new Cell { CellReference = reference, DataType = CellValues.InlineString, StyleIndex = styleIndex };
        c.Append(new InlineString(new Text(text)));
        return c;
    }

    static Cell NumCell(string reference, double value, uint styleIndex = 1)
        => new() { CellReference = reference, CellValue = new CellValue(value.ToString(CultureInfo.InvariantCulture)),
                   DataType = CellValues.Number, StyleIndex = styleIndex };

    static string Col(int col) => ((char)('A' + col - 1)).ToString();

    static string SafeSheetName(string s)
    {
        var clean = s.Length > 31 ? s[..31] : s;
        foreach (var ch in new[] { '\\', '/', '?', '*', '[', ']', ':' }) clean = clean.Replace(ch, '_');
        return string.IsNullOrEmpty(clean) ? "Sheet" : clean;
    }
}
