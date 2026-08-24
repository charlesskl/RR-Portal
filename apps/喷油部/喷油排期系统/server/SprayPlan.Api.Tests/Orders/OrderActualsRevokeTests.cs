using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderActualsRevokeTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;
    private int _orderId;
    private int _secondPlanId;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        await _factory.WithDbAsync(async db =>
        {
            var now = DateTime.UtcNow;
            var product = new Product { ProductNo = "ACTUAL-1", Status = "active", CreatedBy = "admin", CreatedAt = now, UpdatedAt = now };
            db.Products.Add(product);
            await db.SaveChangesAsync();
            var order = new Order
            {
                ExternalOrderNo = "ACTUAL-ORDER-1", ProductId = product.Id, OrderDate = now,
                Status = "in_production", CreatedBy = "admin", CreatedAt = now, UpdatedAt = now,
                PartQtys = [new OrderPartQty { PartName = "部位A", Qty = 200, PartOrder = 0 }]
            };
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            var lineId = await db.ProductionLines.Select(x => x.Id).FirstAsync();
            var plans = new[]
            {
                new ProductionPlan { PlanDate = new DateTime(2026, 8, 16, 0, 0, 0, DateTimeKind.Utc), LineId = lineId, OrderId = order.Id, PartName = "部位A", PlannedQty = 100, GoodQty = 100, InboundQty = 20, Status = "recorded", CreatedBy = "admin", CreatedAt = now, LastModifiedAt = now },
                new ProductionPlan { PlanDate = new DateTime(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc), LineId = lineId, OrderId = order.Id, PartName = "部位A", PlannedQty = 100, GoodQty = 10, InboundQty = 0, Status = "recorded", CreatedBy = "admin", CreatedAt = now, LastModifiedAt = now },
            };
            db.ProductionPlans.AddRange(plans);
            await db.SaveChangesAsync();
            _orderId = order.Id;
            _secondPlanId = plans[1].Id;
        });
    }

    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task Login(string username, string password)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();

    [Fact]
    public async Task Inbound_CanExceedTodayProduction_ButCannotExceedAccumulatedWorkshopStock()
    {
        await Login("clerk", "clerk123");
        var allowed = await _client.PatchAsJsonAsync($"/api/plans/{_secondPlanId}", new { goodQty = 10, inboundQty = 50 });
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);

        var rejected = await _client.PatchAsJsonAsync($"/api/plans/{_secondPlanId}", new { goodQty = 10, inboundQty = 100 });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    [Fact]
    public async Task RevokeActuals_IsAdminOnly_AndSupportsDayThenAll()
    {
        await Login("clerk", "clerk123");
        var forbidden = await _client.PostAsJsonAsync($"/api/orders/{_orderId}/revoke-actuals", new { scope = "all" });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        await Login("admin", "admin123");
        var day = await _client.PostAsJsonAsync($"/api/orders/{_orderId}/revoke-actuals", new { scope = "day", date = "2026-08-17" });
        Assert.Equal(HttpStatusCode.OK, day.StatusCode);
        await _factory.WithDbAsync(async db =>
        {
            var plans = await db.ProductionPlans.Where(p => p.OrderId == _orderId).OrderBy(p => p.PlanDate).ToListAsync();
            Assert.Equal(100, plans[0].GoodQty);
            Assert.Null(plans[1].GoodQty);
            Assert.Null(plans[1].InboundQty);
            Assert.Equal("in_production", (await db.Orders.FindAsync(_orderId))!.Status);
        });

        var all = await _client.PostAsJsonAsync($"/api/orders/{_orderId}/revoke-actuals", new { scope = "all" });
        Assert.Equal(HttpStatusCode.OK, all.StatusCode);
        await _factory.WithDbAsync(async db =>
        {
            Assert.All(await db.ProductionPlans.Where(p => p.OrderId == _orderId).ToListAsync(), p =>
            {
                Assert.Null(p.GoodQty);
                Assert.Null(p.InboundQty);
                Assert.Equal("planned", p.Status);
            });
            Assert.Equal("scheduled", (await db.Orders.FindAsync(_orderId))!.Status);
        });
    }
}
