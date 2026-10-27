using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderOverviewEditTests : IAsyncLifetime
{
    private ApiFactory factory = null!;
    private HttpClient client = null!;
    private int orderId;

    public async Task InitializeAsync()
    {
        factory = new ApiFactory();
        client = factory.CreateClient();
        await factory.SeedAsync();
        await Login("clerk", "clerk123");
        await factory.WithDbAsync(async db =>
        {
            var now = DateTime.UtcNow;
            var order = new Order {
                ExternalOrderNo = "INLINE-1", OrderDate = now, DeliveryDate = now.Date,
                Status = "scheduled", CreatedBy = "test", CreatedAt = now, UpdatedAt = now,
                PartQtys = new() {
                    new() { PartName = "头", Qty = 100 },
                    new() { PartName = "脚", Qty = 50 }
                }
            };
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            orderId = order.Id;
            db.ProductionPlans.Add(new ProductionPlan {
                OrderId = order.Id, LineId = await db.ProductionLines.Select(l => l.Id).FirstAsync(),
                PlanDate = now.Date, PartName = "头", PlannedQty = 100, GoodQty = 20,
                Status = "recorded", CreatedBy = "test", CreatedAt = now, LastModifiedAt = now
            });
            await db.SaveChangesAsync();
        });
    }

    private async Task Login(string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();

    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }

    [Fact]
    public async Task SaveScheduledOrder_PersistsBothFieldsAndRefreshesDemandWithoutChangingPlans()
    {
        (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { deliveryDate = "2026-11-30", totalQty = 200 })).EnsureSuccessStatusCode();
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        Assert.StartsWith("2026-11-30", detail.GetProperty("deliveryDate").GetString());
        Assert.Equal(new[] { 200, 100 }, detail.GetProperty("partQtys").EnumerateArray().Select(q => q.GetProperty("qty").GetInt32()).ToArray());
        var list = await client.GetFromJsonAsync<JsonElement>("/api/orders");
        Assert.Equal(200, list[0].GetProperty("totalQty").GetInt32());
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        Assert.Equal(200, overview[0].GetProperty("demandQty").GetInt32());
        Assert.Equal(180, overview[0].GetProperty("remainingQty").GetInt32());
        Assert.False(overview[0].GetProperty("scheduleCovered").GetBoolean());
        await factory.WithDbAsync(async db => {
            var plan = await db.ProductionPlans.SingleAsync(p => p.OrderId == orderId);
            Assert.Equal(100, plan.PlannedQty);
            Assert.Equal(20, plan.GoodQty);
        });
    }

    [Fact]
    public async Task ClearDeliveryDate_LeavesQuantitiesUntouched()
    {
        (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { deliveryDate = "" })).EnsureSuccessStatusCode();
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("deliveryDate").ValueKind);
        Assert.Equal(100, detail.GetProperty("partQtys")[0].GetProperty("qty").GetInt32());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task InvalidQuantity_DoesNotSaveDateEither(int totalQty)
    {
        var result = await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { deliveryDate = "2026-11-30", totalQty });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        await factory.WithDbAsync(async db => {
            var order = await db.Orders.SingleAsync(o => o.Id == orderId);
            Assert.NotEqual(new DateTime(2026, 11, 30), order.DeliveryDate);
            Assert.Equal(100, await db.OrderPartQtys.Where(q => q.OrderId == orderId).MaxAsync(q => q.Qty));
        });
    }

    [Fact]
    public async Task Viewer_CannotSave()
    {
        await Login("viewer", "viewer123");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { totalQty = 200 })).StatusCode);
    }

    [Fact]
    public async Task ArchivedOrder_CannotChangeTotal()
    {
        await factory.WithDbAsync(async db => {
            (await db.Orders.SingleAsync(o => o.Id == orderId)).Status = "archived";
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { totalQty = 200 })).StatusCode);
    }
}
