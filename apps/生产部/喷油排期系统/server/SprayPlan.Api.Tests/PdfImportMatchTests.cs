using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// PDF 委托加工合同导入 —— 子件精确匹配测试
// 覆盖：MatchItems（绿=命中产品库，红=null）
public class PdfImportMatchTests
{
    [Fact]
    public void MatchItems_HitReturnsName_MissReturnsNull()
    {
        var productItemNames = new[] { "兔子", "青蛙", "顶盖1", "青蛙前" };

        var lines = new List<PdfImportParse.DraftLine>
        {
            new("兔子(印喷件)",   "兔子",   7898,  2),  // 命中
            new("青蛙后(印喷件)", "青蛙后", 30780, 1),  // 未命中
        };

        var result = PdfImportParse.MatchItems(lines, productItemNames);

        Assert.Equal(2, result.Count);

        // 第 1 行：绿
        Assert.Equal("兔子(印喷件)", result[0].PdfItemName);
        Assert.Equal(7898,            result[0].TotalQty);
        Assert.Equal(2,               result[0].MergedRows);
        Assert.Equal("兔子",          result[0].MatchedItemName);

        // 第 2 行：红（null）
        Assert.Equal("青蛙后(印喷件)", result[1].PdfItemName);
        Assert.Null(result[1].MatchedItemName);
    }

    [Fact]
    public void MatchItems_ProductNamesWithExtraSpaces_StillMatch()
    {
        // 产品库名称前后有空格，应仍能命中
        var productItemNames = new[] { " 青蛙前 ", "顶盖1" };

        var lines = new List<PdfImportParse.DraftLine>
        {
            new("青蛙前(印喷件)", "青蛙前", 5000, 1),
        };

        var result = PdfImportParse.MatchItems(lines, productItemNames);

        Assert.Equal("青蛙前", result[0].MatchedItemName);
    }
}
