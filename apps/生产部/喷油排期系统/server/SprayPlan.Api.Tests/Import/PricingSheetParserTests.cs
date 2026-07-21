using SprayPlan.Api.Services.Import;
using Xunit;

namespace SprayPlan.Api.Tests.Import;

public class PricingSheetParserTests
{
    static string?[][] G(params string?[][] rows) => rows;
    static string?[] R(params string?[] cells) => cells;

    [Fact]
    public void TwoLevel_NoPositionCol_UsesNameAsPart_AndCommonPrefixAsItem()
    {
        var grid = G(
            R("47101核价"),
            R("货号", "货名", "工序", "目标数", "人数", "工价", "核价", "油漆价", "报价", "备注"),
            R("47101", "联合收割机右身", "喷油", "2600", "2", "0.138", "0.291", "0.174", "0.4", ""),
            R("", "联合收割机车底", "移印", "9000", "1", "0.02", "0.042", "0.025", "0.08", "")
        );
        var s = PricingSheetParser.Parse(grid, "47101");
        Assert.True(s.Recognized);
        Assert.False(s.IsThreeLevel);
        Assert.Equal("47101", s.ProductNo);
        Assert.Equal("联合收割机", s.SuggestedItemName);
        Assert.Equal(2, s.Parts.Count);
        Assert.Equal("联合收割机", s.Parts[0].ItemName);
        Assert.Equal("联合收割机右身", s.Parts[0].PartName);
        Assert.Equal("喷油", s.Parts[0].CraftDetail);
        Assert.Equal("手喷", s.Parts[0].Category);
        Assert.Equal(2600, s.Parts[0].DailyCapacity);
        Assert.Equal(2, s.Parts[0].StdMachineCount);
        Assert.Equal(0.291, s.Parts[0].UnitCost, 3);
        Assert.Equal(0.174, s.Parts[0].PaintCost, 3);
        Assert.Equal("移印", s.Parts[1].Category);
    }

    [Fact]
    public void ThreeLevel_WithPositionCol_SplitsItemAndPart_CarriesMergedName()
    {
        var grid = G(
            R("兴信77770核价"),
            R("货号", "货名", "位置", "工序", "目标数", "人数", "工价", "核价", "油漆价", "报价", "备注"),
            R("77770", "3#包包", "大身拉链1", "移印", "10800", "1", "0.015", "0.0315", "0.008", "0.04", ""),
            R("", "", "大身", "自动", "4800", "1", "0.039", "0.081", "0.072", "0.16", ""),
            R("", "3#鞋子", "左鞋1#", "移印", "7000", "1", "0.03", "0.063", "0.017", "0.08", "")
        );
        var s = PricingSheetParser.Parse(grid, "77770");
        Assert.True(s.Recognized);
        Assert.True(s.IsThreeLevel);
        Assert.Equal("77770", s.ProductNo);
        Assert.Equal(3, s.Parts.Count);
        Assert.Equal("3#包包", s.Parts[0].ItemName);
        Assert.Equal("大身拉链1", s.Parts[0].PartName);
        Assert.Equal("3#包包", s.Parts[1].ItemName);
        Assert.Equal("大身", s.Parts[1].PartName);
        Assert.Equal("自动喷", s.Parts[1].Category);
        Assert.Equal("3#鞋子", s.Parts[2].ItemName);
    }

    [Fact]
    public void UnknownCraft_LeavesCategoryNull()
    {
        var grid = G(
            R("货号", "货名", "位置", "工序", "目标数", "人数", "工价", "核价", "油漆价", "报价"),
            R("77770", "13#鞋子", "左右", "", "5800", "7", "0.22", "0.462", "0.238", "0.7"),
            R("", "9#鞋垫", "鞋垫", "摆货", "9500", "2", "0.046", "0.0966", "0.043", "0.14")
        );
        var s = PricingSheetParser.Parse(grid, "x");
        Assert.Null(s.Parts[0].Category);
        Assert.Equal("", s.Parts[0].CraftDetail);
        Assert.Null(s.Parts[1].Category);
        Assert.Equal("摆货", s.Parts[1].CraftDetail);
    }

    [Fact]
    public void NoStandardHeader_NotRecognized()
    {
        var grid = G(
            R("产品编号", "配件名称", "目标数", "生产人数", "核价人工", "油漆港币", "实际核价", "备注"),
            R("91039", "大宾果眼睛白", "8100", "2", "0.088", "0.0132", "0.1012", "移印")
        );
        var s = PricingSheetParser.Parse(grid, "91039");
        Assert.False(s.Recognized);
        Assert.NotNull(s.UnrecognizedReason);
        Assert.Empty(s.Parts);
    }

    [Fact]
    public void ProductNo_FallsBackToSheetName_WhenColumnEmpty()
    {
        var grid = G(
            R("货号", "货名", "工序", "核价"),
            R("", "披萨", "UV", "0.034")
        );
        var s = PricingSheetParser.Parse(grid, "9548");
        Assert.Equal("9548", s.ProductNo);
        Assert.Equal("UV", s.Parts[0].Category);
    }

    [Fact]
    public void SkipsEmptyAndSummaryRows()
    {
        var grid = G(
            R("货号", "货名", "工序", "核价"),
            R("47101", "右身", "喷油", "0.29"),
            R("", "", "", ""),
            R("", "相差", "", "0.003")
        );
        var s = PricingSheetParser.Parse(grid, "47101");
        Assert.Single(s.Parts);
        Assert.Equal("右身", s.Parts[0].PartName);
    }

    [Fact]
    public void ThreeLevel_PositionEmpty_FallsBackToNameAsPart()
    {
        // 三层表里某行有货名但位置为空 → 该子件单部位，部位名退回用货名
        var grid = G(
            R("货号", "货名", "位置", "工序", "核价"),
            R("12345", "外壳", "", "喷油", "0.2")
        );
        var s = PricingSheetParser.Parse(grid, "12345");
        Assert.True(s.IsThreeLevel);
        Assert.Single(s.Parts);
        Assert.Equal("外壳", s.Parts[0].ItemName);
        Assert.Equal("外壳", s.Parts[0].PartName);
    }

    // ── 子件自动归类（spec §4）──────────────────────────────────────────

    [Fact]
    public void DeriveSubItems_本体优先_带后缀行归到本体()
    {
        // 兔子/熊 有本体行 → 兔子耳朵归兔子、熊耳朵归熊
        var names = new List<string> { "兔子", "兔子耳朵", "熊", "熊耳朵", "青蛙" };
        var items = PricingSheetParser.DeriveSubItems(names);
        Assert.Equal(new[] { "兔子", "兔子", "熊", "熊", "青蛙" }, items);
    }

    [Fact]
    public void DeriveSubItems_共同前缀_多行归到前缀()
    {
        // 无本体行，但多行共享长前缀 → 归该前缀；方向盘自成组
        var names = new List<string> { "联合收割机右身", "联合收割机车底", "联合收割机前窗", "方向盘" };
        var items = PricingSheetParser.DeriveSubItems(names);
        Assert.Equal(new[] { "联合收割机", "联合收割机", "联合收割机", "方向盘" }, items);
    }

    [Fact]
    public void DeriveSubItems_无本体无兄弟_自成组_且不误并单字前缀()
    {
        // 猫头鹰眼睛/小狗眼睛/螃蟹眼睛 各自成组；小猫 vs 小狗眼睛 只共享"小"(1字)不并
        var names = new List<string> { "小猫", "猫头鹰眼睛", "小狗眼睛", "螃蟹眼睛" };
        var items = PricingSheetParser.DeriveSubItems(names);
        Assert.Equal(new[] { "小猫", "猫头鹰眼睛", "小狗眼睛", "螃蟹眼睛" }, items);
    }

    [Fact]
    public void TwoLevel_部位名保持货名原文_子件为归类结果()
    {
        var grid = G(
            R("11494核价"),
            R("货号", "货名", "工序", "目标数", "人数", "工价", "核价", "油漆价", "报价", "备注"),
            R("11494", "兔子", "移印", "3000", "1", "0.06", "0.126", "0.014", "0.14", ""),
            R("", "兔子耳朵", "移印", "9000", "1", "0.04", "0.069", "0.07", "0.14", ""),
            R("", "猫头鹰眼睛", "移印", "3000", "1", "0.06", "0.103", "0.072", "0.18", "")
        );
        var s = PricingSheetParser.Parse(grid, "11494");
        Assert.False(s.IsThreeLevel);
        Assert.Equal(3, s.Parts.Count);
        // 部位名 = 货名原文（不砍不改）
        Assert.Equal(new[] { "兔子", "兔子耳朵", "猫头鹰眼睛" }, s.Parts.Select(p => p.PartName).ToArray());
        // 子件 = 归类结果
        Assert.Equal(new[] { "兔子", "兔子", "猫头鹰眼睛" }, s.Parts.Select(p => p.ItemName).ToArray());
    }
}
