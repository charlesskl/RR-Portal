using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderResizeReviewBoundaryTests
{
    [Fact]
    public void ResizeToMaximumInteger_DistributesLargeGroupWithoutOverflow()
    {
        var parts = new List<OrderPartQty> {
            new() { Id = 1, PartName = "头", Qty = int.MaxValue },
            new() { Id = 2, PartName = "头", Qty = int.MaxValue },
            new() { Id = 3, PartName = "脚", Qty = 1 }
        };
        OrderCalc.ResizeDemand(parts, int.MaxValue);
        Assert.Equal(int.MaxValue, parts.Where(p => p.PartName == "头").Sum(p => p.Qty));
        Assert.Equal(1, parts.Single(p => p.PartName == "脚").Qty);
        Assert.All(parts, p => Assert.InRange(p.Qty, 0, int.MaxValue));
        var quantities = parts.Select(p => p.Qty).ToArray();
        OrderCalc.ResizeDemand(parts, int.MaxValue);
        Assert.Equal(quantities, parts.Select(p => p.Qty));
    }

    [Fact]
    public void ResizeToSmallTotal_ZeroDemandDoesNotBlockFinishedOrder()
    {
        var order = new Order {
            PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 1 } },
            Plans = new() { new() { PartName = "头", StepNo = 1, PlannedQty = 1, GoodQty = 1 } }
        };
        OrderCalc.ResizeDemand(order.PartQtys, 1);
        Assert.Equal(new[] { 1, 0 }, order.PartQtys.Select(p => p.Qty));
        Assert.Equal(0, OrderCalc.RemainingQty(order));
    }

    [Fact]
    public void ResizeAndRemaining_IgnoreZeroDemandWithoutChangingPlanActuals()
    {
        var head = new ProductionPlan { PartName = "头", StepNo = 1, PlannedQty = 100, GoodQty = 1, InboundQty = 1 };
        var foot = new ProductionPlan { PartName = "脚", StepNo = 1, PlannedQty = 10, GoodQty = 8, InboundQty = 7 };
        var order = new Order {
            PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 1 } },
            Plans = new() { head, foot }
        };
        OrderCalc.ResizeDemand(order.PartQtys, 1);
        Assert.Equal(0, OrderCalc.RemainingQty(order));
        Assert.Equal((100, 1, 1), (head.PlannedQty, head.GoodQty, head.InboundQty));
        Assert.Equal((10, 8, 7), (foot.PlannedQty, foot.GoodQty, foot.InboundQty));
        OrderCalc.ResizeDemand(order.PartQtys, 1);
        Assert.Equal(new[] { 1, 0 }, order.PartQtys.Select(p => p.Qty));
    }

    [Fact]
    public async Task ResizeToSmallTotal_ZeroDemandDoesNotBlockOverviewCoverageOrProgress()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var id = 0;
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "BOUNDARY-ZERO", Status = "scheduled", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 1 } } };
            db.Orders.Add(order); await db.SaveChangesAsync(); id = order.Id;
            db.ProductionPlans.Add(new ProductionPlan { OrderId = id, LineId = await db.ProductionLines.Select(p => p.Id).FirstAsync(),
                PlanDate = DateTime.UtcNow.Date, PartName = "头", StepNo = 1, PlannedQty = 1, GoodQty = 1 });
            await db.SaveChangesAsync();
        });
        (await client.PatchAsJsonAsync($"/api/orders/{id}", new { totalQty = 1 })).EnsureSuccessStatusCode();
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        var item = overview.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);
        Assert.True(item.GetProperty("scheduleCovered").GetBoolean());
        Assert.Equal(100, item.GetProperty("progressPct").GetInt32());
        Assert.Equal(0, item.GetProperty("remainingQty").GetInt32());
        Assert.Equal(0, item.GetProperty("inProductionRemainingQty").GetInt32());
    }

    [Fact]
    public async Task TotalQuantityCannotModifyAnotherFactoryOrder()
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        var id = 0;
        await factory.WithDbAsync(async db => {
            var order = new Order { FactoryId = "HUADENG", ExternalOrderNo = "OTHER-FACTORY", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 } } };
            db.Orders.Add(order); await db.SaveChangesAsync(); id = order.Id;
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        Assert.Equal(System.Net.HttpStatusCode.NotFound,
            (await client.PatchAsJsonAsync($"/api/orders/{id}", new { totalQty = 1 })).StatusCode);
        await factory.WithDbAsync(async db => {
            Assert.Equal(100, await db.OrderPartQtys.Where(p => p.OrderId == id).Select(p => p.Qty).SingleAsync());
        });
    }
}
