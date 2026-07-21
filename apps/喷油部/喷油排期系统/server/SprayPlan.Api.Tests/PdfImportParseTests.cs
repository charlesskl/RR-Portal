using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// PDF 委托加工合同导入 —— 纯逻辑解析函数测试
// 覆盖：ParseProductNoAndMa / NormalizeItemName / AggregateByItem / BuildDraftLines
public class PdfImportParseTests
{
    // ─────────────────────────────────────────────────────────────────────────
    // 1. ParseProductNoAndMa（拆款号与 MA 标记）
    // ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("15787 总MA", "15787", true)]
    [InlineData("11494",      "11494", false)]
    [InlineData("15787MA",    "15787", true)]
    [InlineData("  22886  ",  "22886", false)]
    // 验证多段含数字时取最靠前的款号；"波兰版本"里没数字，第一段数字就是 11494
    [InlineData("11494/11494-波兰版本", "11494", false)]
    public void ParseProductNoAndMa_VariousCells(string cell, string expectedNo, bool expectedMa)
    {
        var result = PdfImportParse.ParseProductNoAndMa(cell);
        Assert.Equal(expectedNo, result.ProductNo);
        Assert.Equal(expectedMa, result.IsMa);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. NormalizeItemName（砍"(印喷件)"后缀）
    // ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("兔子(印喷件)",           "兔子")]
    [InlineData("E-11-06/35mm眼扣(印喷件)", "E-11-06/35mm眼扣")]
    [InlineData("青蛙前 (印喷件) ",        "青蛙前")]
    [InlineData("青蛙后（印喷件）",         "青蛙后")]
    [InlineData("顶盖1",                 "顶盖1")]
    public void NormalizeItemName_VariousSuffixes(string raw, string expected)
    {
        Assert.Equal(expected, PdfImportParse.NormalizeItemName(raw));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. AggregateByItem（按子件合计颜色行，保持首次出现顺序）
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AggregateByItem_MergesAndKeepsOrder()
    {
        // 兔子×3 青蛙×1 兔子×1 顶盖1×1 兔子×1 → 3 个 AggItem
        var rows = new List<PdfImportParse.RawLine>
        {
            new("兔子(印喷件)",   3949),
            new("青蛙(印喷件)",   3949),
            new("兔子(印喷件)",   3949),
            new("顶盖1(印喷件)", 30780),
            new("兔子(印喷件)",   3949),
        };

        var result = PdfImportParse.AggregateByItem(rows);

        Assert.Equal(3, result.Count);

        // 兔子：3 行合计 11847
        Assert.Equal("兔子",  result[0].ItemName);
        Assert.Equal(11847,   result[0].TotalQty);
        Assert.Equal(3,       result[0].MergedRows);

        // 青蛙在第 2 位
        Assert.Equal("青蛙",  result[1].ItemName);

        // 顶盖1：单行
        Assert.Equal("顶盖1", result[2].ItemName);
        Assert.Equal(30780,   result[2].TotalQty);
        Assert.Equal(1,       result[2].MergedRows);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. BuildDraftLines（保留首次原始名 + 合计 + 归一名）
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void BuildDraftLines_PreservesFirstRawName()
    {
        var rows = new List<PdfImportParse.RawLine>
        {
            new("兔子(印喷件)",   3949),
            new("兔子(印喷件)",   3949),
            new("顶盖1(印喷件)", 30780),
        };

        var result = PdfImportParse.BuildDraftLines(rows);

        Assert.Equal(2, result.Count);

        // 第 1 行：原始名/归一名/合计/合并行数
        Assert.Equal("兔子(印喷件)", result[0].PdfItemName);
        Assert.Equal("兔子",         result[0].NormalizedName);
        Assert.Equal(7898,           result[0].TotalQty);
        Assert.Equal(2,              result[0].MergedRows);

        // 第 2 行
        Assert.Equal("顶盖1(印喷件)", result[1].PdfItemName);
        Assert.Equal("顶盖1",         result[1].NormalizedName);
        Assert.Equal(30780,            result[1].TotalQty);
        Assert.Equal(1,                result[1].MergedRows);
    }
}
