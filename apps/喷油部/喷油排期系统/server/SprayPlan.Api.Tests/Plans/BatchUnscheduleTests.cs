using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Plans;

public class BatchUnscheduleTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" }))
            .EnsureSuccessStatusCode();
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task<(int Order1, int Order2, int Plan1, int Plan2)> SeedPlans(string secondStatus = "planned")
    {
        var result = (Order1: 0, Order2: 0, Plan1: 0, Plan2: 0);
        await _factory.WithDbAsync(async db =>
        {
            var lineId = await db.ProductionLines.OrderBy(x => x.Id).Select(x => x.Id).FirstAsync();
            var now = DateTime.UtcNow;
            var o1 = new Order { ExternalOrderNo = $"BATCH-{Guid.NewGuid():N}-1", OrderDate = now, Status = "scheduled", CreatedBy = "test", CreatedAt = now, UpdatedAt = now };
            var o2 = new Order { ExternalOrderNo = $"BATCH-{Guid.NewGuid():N}-2", OrderDate = now, Status = "scheduled", CreatedBy = "test", CreatedAt = now, UpdatedAt = now };
            db.Orders.AddRange(o1, o2);
            await db.SaveChangesAsync();
            var p1 = new ProductionPlan { OrderId = o1.Id, LineId = lineId, PlanDate = now, ItemName = "A", PartName = "P", PlannedQty = 10, Status = "planned", CreatedBy = "test", CreatedAt = now, LastModifiedAt = now };
            var p2 = new ProductionPlan { OrderId = o2.Id, LineId = lineId, PlanDate = now, ItemName = "B", PartName = "P", PlannedQty = 20, Status = secondStatus, GoodQty = secondStatus == "recorded" ? 20 : null, CreatedBy = "test", CreatedAt = now, LastModifiedAt = now };
            db.ProductionPlans.AddRange(p1, p2);
            await db.SaveChangesAsync();
            result = (o1.Id, o2.Id, p1.Id, p2.Id);
        });
        return result;
    }

    [Fact]
    public async Task BatchUnschedule_SoftDeletesAllAndResetsOrders()
    {
        var x = await SeedPlans();
        var response = await _client.PostAsJsonAsync("/api/plans/batch-unschedule", new { planIds = new[] { x.Plan1, x.Plan2 }, reason = "计划调整" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await _factory.WithDbAsync(async db =>
        {
            var plans = await db.ProductionPlans.Where(p => p.Id == x.Plan1 || p.Id == x.Plan2).ToListAsync();
            Assert.All(plans, p => Assert.NotNull(p.DeletedAt));
            Assert.All(plans, p =>
            {
                using var history = JsonDocument.Parse(p.ModificationHistory);
                Assert.Equal("计划调整", history.RootElement[0].GetProperty("reason").GetString());
            });
            var orders = await db.Orders.Where(o => o.Id == x.Order1 || o.Id == x.Order2).ToListAsync();
            Assert.All(orders, o => Assert.Equal("received", o.Status));
        });
    }

    [Fact]
    public async Task BatchUnschedule_WithRecordedPlanRejectsWholeBatch()
    {
        var x = await SeedPlans("recorded");
        var response = await _client.PostAsJsonAsync("/api/plans/batch-unschedule", new { planIds = new[] { x.Plan1, x.Plan2 }, reason = "计划调整" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        await _factory.WithDbAsync(async db =>
        {
            var plans = await db.ProductionPlans.Where(p => p.Id == x.Plan1 || p.Id == x.Plan2).ToListAsync();
            Assert.All(plans, p => Assert.Null(p.DeletedAt));
        });
    }
}
