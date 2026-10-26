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
        await factory.WithDbAsync(async db => {
            Assert.Equal("completed", (await db.Orders.SingleAsync(order => order.Id == id)).Status);
        });
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

    [Theory]
    [InlineData(200, "in_production", true)]
    [InlineData(50, "completed", false)]
    [InlineData(100, "completed", false)]
    public async Task ResizingCompletedOrder_DerivesStatusAndPreservesPlans(int totalQty, string status, bool schedulable)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        var id = 0;
        string? planSnapshot = null;
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "COMPLETE-RESIZE", Status = "completed", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 } } };
            db.Orders.Add(order); await db.SaveChangesAsync(); id = order.Id;
            db.ProductionPlans.Add(new ProductionPlan { OrderId = id, LineId = await db.ProductionLines.Select(p => p.Id).FirstAsync(),
                PlanDate = DateTime.UtcNow.Date, PartName = "头", PlannedQty = 100, GoodQty = 100, Status = "recorded" });
            await db.SaveChangesAsync();
            planSnapshot = JsonSerializer.Serialize(await db.ProductionPlans.AsNoTracking().Where(p => p.OrderId == id).OrderBy(p => p.Id).ToListAsync());
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        (await client.PatchAsJsonAsync($"/api/orders/{id}", new { totalQty, deliveryDate = "2026-11-30" })).EnsureSuccessStatusCode();
        var list = await client.GetFromJsonAsync<JsonElement>("/api/orders");
        var item = list.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);
        Assert.Equal(status, item.GetProperty("status").GetString());
        Assert.StartsWith("2026-11-30", item.GetProperty("deliveryDate").GetString());
        var schedule = await client.GetFromJsonAsync<JsonElement>("/api/schedule/orders");
        Assert.Equal(schedulable, schedule.EnumerateArray().Any(p => p.GetProperty("id").GetInt32() == id));
        (await client.PatchAsJsonAsync($"/api/orders/{id}", new { totalQty })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.Equal(status, (await db.Orders.SingleAsync(o => o.Id == id)).Status);
            Assert.Equal(planSnapshot, JsonSerializer.Serialize(await db.ProductionPlans.AsNoTracking().Where(p => p.OrderId == id).OrderBy(p => p.Id).ToListAsync()));
        });
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DateOrSameQuantity_DoesNotReclassifyHistoricalStatus(bool includeSameQuantity)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        await factory.SeedAsync();
        var id = 0;
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "HISTORICAL-STATUS", Status = "completed", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 } } };
            db.Orders.Add(order); await db.SaveChangesAsync(); id = order.Id;
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var payload = new Dictionary<string, object> { ["deliveryDate"] = "2026-11-30" };
        if (includeSameQuantity) payload["totalQty"] = 100;
        (await client.PatchAsJsonAsync($"/api/orders/{id}", payload)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.Equal("completed", (await db.Orders.SingleAsync(o => o.Id == id)).Status);
        });
    }

    [Theory]
    [InlineData("draft", "draft")]
    [InlineData("received", "received")]
    [InlineData("completed", "received")]
    public void DemandStatus_NoLivePlansPreservesDraftOtherwiseReceived(string current, string expected)
    {
        Assert.Equal(expected, OrderCalc.DemandStatus(current,
            new[] { new OrderPartQty { PartName = "头", Qty = 10 } },
            new[] { new ProductionPlan { PartName = "头", GoodQty = 10, DeletedAt = DateTime.UtcNow } }));
    }

    [Fact]
    public void DemandStatus_RequiresEachPositivePartAndEveryProcess()
    {
        var parts = new List<OrderPartQty> { new() { PartName = "头", Qty = 10 }, new() { PartName = "脚", Qty = 0 } };
        var plans = new List<ProductionPlan> { new() { PartName = "头", StepNo = 1, GoodQty = 10 }, new() { PartName = "头", StepNo = 2, GoodQty = 5 } };
        Assert.Equal("in_production", OrderCalc.DemandStatus("completed", parts, plans));
        plans[1].GoodQty = 10;
        Assert.Equal("completed", OrderCalc.DemandStatus("in_production", parts, plans));
        parts.Add(new() { PartName = "身", Qty = 5 });
        Assert.Equal("in_production", OrderCalc.DemandStatus("in_production", parts, plans));
        Assert.Equal("scheduled", OrderCalc.DemandStatus("received", parts, new[] { new ProductionPlan { PartName = "头", PlannedQty = 10 } }));
    }
}
