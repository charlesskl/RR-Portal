using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

public class ScheduleCalcTests
{
    [Fact] public void PartDailyOutput_MultipliesResourceByCapacity() { Assert.Equal(2000, ScheduleCalc.PartDailyOutput(2, 1000)); Assert.Equal(0, ScheduleCalc.PartDailyOutput(-1, 1000)); }
    [Fact] public void PartRemainingDays_Cases() { Assert.Null(ScheduleCalc.PartRemainingDays(100, 0)); Assert.Equal(0, ScheduleCalc.PartRemainingDays(0, 50)); Assert.Equal(4, ScheduleCalc.PartRemainingDays(100, 30)); }
    [Fact] public void OrderRemainingDays_TakesMaxBucket() => Assert.Equal(4, ScheduleCalc.OrderRemainingDays(new[] { (100, 1, 50), (100, 1, 30) }));
    [Fact] public void OrderRemainingDays_NullIfAnyUnestimable() => Assert.Null(ScheduleCalc.OrderRemainingDays(new[] { (100, 1, 50), (100, 1, 0) }));
    [Fact] public void OrderRemainingDays_EmptyIsZero() => Assert.Equal(0, ScheduleCalc.OrderRemainingDays(Array.Empty<(int, int, int)>()));
    [Fact] public void OrderFirstPlanDate_EarliestOrNull() { Assert.Equal("2026-06-01", ScheduleCalc.OrderFirstPlanDate(new[] { "2026-06-05", "2026-06-01", "2026-06-03" })); Assert.Null(ScheduleCalc.OrderFirstPlanDate(Array.Empty<string>())); }
    [Fact] public void WeeklyPlanDates_MapsOffsets() => Assert.Equal(new[] { "2026-06-01", "2026-06-03", "2026-06-05" }, ScheduleCalc.WeeklyPlanDates(new DateTime(2026, 6, 1), new[] { 0, 2, 4 }));
    [Fact]
    public void PartTotalDemand_SumsMatchingParts()
    {
        var rows = new List<OrderPartQty> { new() { SourcePartId = 1, Qty = 100 }, new() { SourcePartId = 1, Qty = 50 }, new() { SourcePartId = 1, Qty = 30 }, new() { SourcePartId = 2, Qty = 999 } };
        Assert.Equal(180, ScheduleCalc.PartTotalDemand(rows, 1));
    }
}
