using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 对拍 lib/recording.ts 的产值/余下/完工算法
public class RecordingCalcTests
{
    [Fact]
    public void PartUnitPrice_SumsAllFourPrices()
        => Assert.Equal(10.0, RecordingCalc.PartUnitPrice(1, 2, 3, 4));

    [Fact]
    public void ProductionValue_Cases()
    {
        Assert.Equal(500.0, RecordingCalc.ProductionValue(100, 5));
        Assert.Equal(0.0, RecordingCalc.ProductionValue(0, 5));     // 数量 0 → 0
        Assert.Equal(0.0, RecordingCalc.ProductionValue(100, 0));   // 工价 0 → 0
        Assert.Equal(0.0, RecordingCalc.ProductionValue(-1, 5));    // 负数 → 0
    }

    [Fact]
    public void PartRemainingQty_FloorsAtZero()
    {
        Assert.Equal(70, RecordingCalc.PartRemainingQty(100, 30));
        Assert.Equal(0, RecordingCalc.PartRemainingQty(100, 150));   // 超录 → 0
    }

    [Fact]
    public void IsPartComplete_Cases()
    {
        Assert.True(RecordingCalc.IsPartComplete(100, 100));
        Assert.True(RecordingCalc.IsPartComplete(100, 120));
        Assert.False(RecordingCalc.IsPartComplete(100, 99));
        Assert.False(RecordingCalc.IsPartComplete(0, 0));            // 需求 0 → 不算完工
    }

    [Fact]
    public void WorkshopStock_AccumulatesReportedMinusGood()
    {
        // 做10000入8000 → 2000；再做6000入8000 → 累计 16000-16000=0
        Assert.Equal(2000, RecordingCalc.WorkshopStock(new int?[] { 10000 }, new int?[] { 8000 }));
        Assert.Equal(0, RecordingCalc.WorkshopStock(new int?[] { 10000, 6000 }, new int?[] { 8000, 8000 }));
        Assert.Equal(0, RecordingCalc.WorkshopStock(new int?[] { }, new int?[] { }));
        Assert.Equal(5000, RecordingCalc.WorkshopStock(new int?[] { 5000, null }, new int?[] { null }));
    }

    [Fact]
    public void IsOrderComplete_AllPartsMustComplete()
    {
        Assert.True(RecordingCalc.IsOrderComplete(new[] { (100, 100), (50, 60) }));
        Assert.False(RecordingCalc.IsOrderComplete(new[] { (100, 100), (50, 30) }));  // 一个没完工
        Assert.False(RecordingCalc.IsOrderComplete(Array.Empty<(int, int)>()));        // 空 → false
    }
}
