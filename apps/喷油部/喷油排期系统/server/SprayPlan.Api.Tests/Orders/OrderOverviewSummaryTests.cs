using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderOverviewSummaryTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;
    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    [Fact]
    public async Task Overview_ReturnsProgressWithoutLoadingProductGraph()
    {
        var orderId = 0;
        await _factory.WithDbAsync(async db =>
        {
            var lineId = await db.ProductionLines.OrderBy(x => x.Id).Select(x => x.Id).FirstAsync();
            var now = DateTime.UtcNow;
            var order = new Order
            {
                ExternalOrderNo = "SUMMARY-1", OrderDate = now, Status = "scheduled", CreatedBy = "test", CreatedAt = now, UpdatedAt = now,
                PartQtys = new List<OrderPartQty> { new() { PartName = "头", Qty = 100 } }
            };
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            db.ProductionPlans.AddRange(
                new ProductionPlan { OrderId = order.Id, LineId = lineId, PlanDate = new DateTime(2026, 7, 20, 0, 0, 0, DateTimeKind.Utc), ItemName = "兔子", PartName = "头", PlannedQty = 60, GoodQty = 40, Status = "recorded", CreatedBy = "test", CreatedAt = now, LastModifiedAt = now },
                new ProductionPlan { OrderId = order.Id, LineId = lineId, PlanDate = new DateTime(2026, 7, 21, 0, 0, 0, DateTimeKind.Utc), ItemName = "兔子", PartName = "头", PlannedQty = 40, Status = "planned", CreatedBy = "test", CreatedAt = now, LastModifiedAt = now });
            await db.SaveChangesAsync();
            orderId = order.Id;
        });

        var body = await _client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        var row = body.EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == orderId);
        Assert.True(row.GetProperty("scheduled").GetBoolean());
        Assert.True(row.GetProperty("scheduleCovered").GetBoolean());
        Assert.Equal("2026-07-21", row.GetProperty("scheduleFinishDate").GetString());
        Assert.Equal(100, row.GetProperty("plannedQty").GetInt32());
        Assert.Equal(40, row.GetProperty("recordedQty").GetInt32());
        Assert.Equal(40, row.GetProperty("progressPct").GetInt32());
    }
}
