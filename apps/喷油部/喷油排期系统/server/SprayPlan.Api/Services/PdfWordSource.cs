using UglyToad.PdfPig;

namespace SprayPlan.Api.Services;

// PdfPig 薄包装：把 PDF 流抽成"带坐标词"列表。
// 只负责"读 PDF → PdfWord"，不做任何业务逻辑（业务逻辑全在 PdfTableExtractor，可纯单测）。
// PdfPig 的 BoundingBox 用 PDF 原生坐标系：原点左下角，Y(Bottom/Top) 越大越靠上。
public static class PdfWordSource
{
    // 遍历每一页的每个词，产出 PdfWord（含页号、文本、左右下上边界）。
    public static List<PdfWord> Extract(Stream pdf)
    {
        var result = new List<PdfWord>();

        using var doc = PdfDocument.Open(pdf);
        foreach (var page in doc.GetPages())
        {
            foreach (var w in page.GetWords())
            {
                var box = w.BoundingBox;
                result.Add(new PdfWord(
                    Page: page.Number,
                    Text: w.Text,
                    Left: box.Left,
                    Right: box.Right,
                    Bottom: box.Bottom,
                    Top: box.Top
                ));
            }
        }

        return result;
    }
}
