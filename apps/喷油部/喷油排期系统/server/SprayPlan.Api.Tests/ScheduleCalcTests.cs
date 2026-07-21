using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 排期算法对拍 lib/schedule.ts —— 全系统最核心的算法，逐个验证口径一致。
public class ScheduleCalcTests
{
    [Fact]
    public void PartDailyOutput_MultipliesResourceByCapacity()
    {
        Assert.Equal(2000, ScheduleCalc.PartDailyOutput(2, 1000));
        Assert.Equal(0, ScheduleCalc.PartDailyOutput(-1, 1000));   // 负资源截断 0
    }

    [Fact]
    public void PartRemainingDays_Cases()
    {
        Assert.Null(ScheduleCalc.PartRemainingDays(100, 0));        // 日产 0 → null
        Assert.Equal(0, ScheduleCalc.PartRemainingDays(0, 50));     // 余 0 → 0
        Assert.Equal(4, ScheduleCalc.PartRemainingDays(100, 30));   // ceil(100/30)=4
    }

    [Fact]
    public void OrderRemainingDays_TakesMaxBucket()
    {
        // 部位A 100/(1*50)=2天；部位B 100/(1*30)=4天 → 木桶 MAX=4
        var parts = new[] { (100, 1, 50), (100, 1, 30) };
        Assert.Equal(4, ScheduleCalc.OrderRemainingDays(parts));
    }

    [Fact]
    public void OrderRemainingDays_NullIfAnyUnestimable()
    {
        var parts = new[] { (100, 1, 50), (100, 1, 0) };           // B 日产能 0 → null
        Assert.Null(ScheduleCalc.OrderRemainingDays(parts));
    }

    [Fact]
    public void OrderRemainingDays_EmptyIsZero()
        => Assert.Equal(0, ScheduleCalc.OrderRemainingDays(Array.Empty<(int, int, int)>()));

    [Fact]
    public void OrderFirstPlanDate_EarliestOrNull()
    {
        Assert.Equal("2026-06-01", ScheduleCalc.OrderFirstPlanDate(new[] { "2026-06-05", "2026-06-01", "2026-06-03" }));
        Assert.Null(ScheduleCalc.OrderFirstPlanDate(Array.Empty<string>()));
    }

    [Fact]
    public void WeeklyPlanDates_MapsOffsets()
    {
        // 周一 2026-06-01，偏移 [0,2,4] → 01/03/05
        var r = ScheduleCalc.WeeklyPlanDates(new DateTime(2026, 6, 1), new[] { 0, 2, 4 });
        Assert.Equal(new[] { "2026-06-01", "2026-06-03", "2026-06-05" }, r);
    }

    [Fact]
    public void SubItemTotalDemand_SumsAllPartQtys()
    {
        var lines = new List<OrderLine>
        {
            new() { SourceItemId = 1, PartQtys = new() { new() { Qty = 100 }, new() { Qty = 50 } } }, // 150
            new() { SourceItemId = 1, PartQtys = new() { new() { Qty = 30 } } },                       // 30
            new() { SourceItemId = 2, PartQtys = new() { new() { Qty = 999 } } },                      // 别的子件
        };
        Assert.Equal(180, ScheduleCalc.SubItemTotalDemand(lines, 1));
    }
}
