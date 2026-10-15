using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;
public class ProductionCalendarTests
{
    [Fact]
    public void Calendar_SaturdayWorksSundayRestsAndOverridesWin()
    {
        var saturday = new DateTime(2026, 10, 17);
        var sunday = saturday.AddDays(1);
        var defaultCalendar = new ProductionCalendar([]);
        Assert.True(defaultCalendar.IsWorkday(saturday));
        Assert.False(defaultCalendar.IsWorkday(sunday));
        Assert.Equal(sunday.AddDays(1), defaultCalendar.NextWorkday(sunday));
        var calendar = new ProductionCalendar([new() { Date = saturday, Type = "holiday" }, new() { Date = sunday, Type = "workday" }]);
        Assert.False(calendar.IsWorkday(saturday));
        Assert.True(calendar.IsWorkday(sunday));
        Assert.Equal(sunday, calendar.NextWorkday(saturday));
    }

    [Fact]
    public async Task Reflow_PreservesActualsAndQuantitiesAndMovesFollowingDays()
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        var start = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date.AddDays(10), DateTimeKind.Utc);
        while (start.DayOfWeek != DayOfWeek.Monday) start = start.AddDays(1);
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "CALENDAR", Status = "in_production", OrderDate = start };
            db.Orders.Add(order); await db.SaveChangesAsync();
            db.Holidays.Add(new Holiday { Date = start, Type = "holiday" });
            var first = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", StepNo = 1, PlanDate = start, PlannedQty = 100 };
            var next = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", StepNo = 1, PlanDate = start.AddDays(1), PlannedQty = 50 };
            var actual = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "脚", PlanDate = start, PlannedQty = 100, GoodQty = 0 };
            db.ProductionPlans.AddRange(first, next, actual); await db.SaveChangesAsync();
            Assert.Equal(2, await ProductionCalendar.Reflow(db, "tester"));
            Assert.Equal(start.AddDays(1), first.PlanDate);
            Assert.Equal(start.AddDays(2), next.PlanDate);
            Assert.Equal(start, actual.PlanDate);
            Assert.Equal(150, first.PlannedQty + next.PlannedQty);
            Assert.Contains("planDate", first.ModificationHistory);
            Assert.Equal(0, await ProductionCalendar.Reflow(db, "tester"));
        });
    }
}
