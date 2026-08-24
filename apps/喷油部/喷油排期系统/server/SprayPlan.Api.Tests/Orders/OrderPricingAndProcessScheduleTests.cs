using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Data;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderPricingAndProcessScheduleTests : IAsyncLifetime
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
    public async Task ImportConfirm_NewProduct_SavesOrderPricingAndDraftOrder()
    {
        var response = await _client.PostAsJsonAsync("/api/orders/import-confirm", new
        {
            head = new { externalOrderNo = "PRICE-ORDER-1", orderDate = "2026-08-10", deliveryDate = "2026-08-25", productNo = "157128", isMa = false },
            pdfToken = "price-order.pdf", asPendingProduct = false, savePricing = true,
            lines = new[] { new { matchedItemName = "眼扣", totalQty = 6000, unitPrice = 0.125 } },
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var product = await db.Products.Include(p => p.Parts).SingleAsync(p => p.ProductNo == "157128");
        Assert.Equal("draft", product.Status);
        Assert.Equal(0.125, Assert.Single(product.Parts).UnitCost, 6);
        var order = await db.Orders.Include(o => o.PartQtys).SingleAsync(o => o.ExternalOrderNo == "PRICE-ORDER-1");
        Assert.Equal("draft", order.Status);
        Assert.Equal(product.Id, order.ProductId);
        Assert.False(order.PendingProduct);
        Assert.Equal(6000, Assert.Single(order.PartQtys).Qty);
    }

    [Fact]
    public async Task ProcessSchedule_ConcurrentCrafts_CreateIndependentDailyPlans()
    {
        using (var setupScope = _factory.Services.CreateScope())
        {
            var setupDb = setupScope.ServiceProvider.GetRequiredService<AppDbContext>();
            setupDb.ProductionLines.Add(new SprayPlan.Api.Entities.ProductionLine
            {
                Name = "UV拉", Workshop = "测试", CraftType = "UV", IsActive = true,
            });
            await setupDb.SaveChangesAsync();
        }
        var productResponse = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "PROCESS-1", parts = new[] { new { partName = "外壳", unitCost = 0.2 } },
        });
        productResponse.EnsureSuccessStatusCode();
        var productId = (await productResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var product = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{productId}");
        var partId = product.GetProperty("parts")[0].GetProperty("id").GetInt32();
        var orderResponse = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = "PROCESS-ORDER-1", productId, orderDate = "2026-08-10",
            partQtys = new[] { new { partName = "外壳", sourcePartId = partId, qty = 250 } },
        });
        orderResponse.EnsureSuccessStatusCode();
        var orderId = (await orderResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var orderDetail = await _client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        var partQtyId = orderDetail.GetProperty("partQtys")[0].GetProperty("id").GetInt32();

        var scheduleResponse = await _client.PostAsJsonAsync($"/api/orders/{orderId}/process-schedule", new
        {
            rows = new[]
            {
                new { partQtyId, startDate = "2026-08-13", craft = "移印", dailyTarget = 100 },
                new { partQtyId, startDate = "2026-08-13", craft = "UV", dailyTarget = 125 },
            },
        });
        Assert.Equal(HttpStatusCode.Created, scheduleResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var plans = await db.ProductionPlans.Where(plan => plan.OrderId == orderId).ToListAsync();
        Assert.Equal(5, plans.Count);
        Assert.Equal(3, plans.Count(plan => plan.Craft == "移印"));
        Assert.Equal(2, plans.Count(plan => plan.Craft == "UV"));
        Assert.Equal(2, plans.Where(plan => plan.PlanDate.Date == new DateTime(2026, 8, 13)).Select(plan => plan.Craft).Distinct().Count());
        Assert.Equal("scheduled", (await db.Orders.FindAsync(orderId))!.Status);

        var savedRules = await db.ProductParts.Where(part => part.ProductId == productId).OrderBy(part => part.Craft).ToListAsync();
        Assert.Equal(2, savedRules.Count);
        Assert.Equal(100, savedRules.Single(part => part.Craft == "移印").DailyCapacity);
        Assert.Equal(125, savedRules.Single(part => part.Craft == "UV").DailyCapacity);
        Assert.All(savedRules, part => Assert.Equal(2, part.CraftPasses));
        Assert.Equal(0.2, savedRules.Sum(part => part.UnitCost), 6);
    }
}
