namespace SprayPlan.Api.Services;

// PDF 单个"带坐标词"的最小数据载体。
// 坐标用 PDF 原生坐标系：原点在左下角，Y(Bottom/Top) 越大越靠页面上方。
// Left/Right = 词包围盒水平边界；Bottom/Top = 垂直边界。
public record PdfWord(int Page, string Text, double Left, double Right, double Bottom, double Top)
{
    // 词的水平中心 X（部分场景需要）
    public double CenterX => (Left + Right) / 2;
}
