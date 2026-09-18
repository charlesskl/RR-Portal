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
    [Fact]
    public async Task MultiProductOrder_SchedulesEachProductAgainstItsOwnPricingRules()
    {
        var imported = await _client.PostAsJsonAsync("/api/orders/import-confirm-multi", new
        {
            head = new { externalOrderNo = "MULTI-1", orderDate = "2026-09-18", deliveryDate = "2026-09-28", productNo = "15792", isMa = true },
            pdfToken = "multi.pdf", savePricing = true,
            products = new object[]
            {
                new { productNo = "15792", isMa = true, lines = new[] { new { matchedItemName = "尾扣", totalQty = 417, unitPrice = 0.0 } } },
                new { productNo = "15783", isMa = true, lines = new[] { new { matchedItemName = "眼扣", totalQty = 21000, unitPrice = 0.14 } } },
            },
        });
        imported.EnsureSuccessStatusCode();
        var orderId = (await imported.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        Assert.Equal(2, detail.GetProperty("products").GetArrayLength());
        var parts = detail.GetProperty("partQtys").EnumerateArray().ToArray();
        var schedule = await _client.PostAsJsonAsync($"/api/orders/{orderId}/process-schedule", new
        {
            rows = parts.Select(part => new { partQtyId = part.GetProperty("id").GetInt32(), startDate = "2026-09-20", craft = "移印", dailyTarget = 1000, laborPrice = 0.08 }),
        });
        Assert.Equal(HttpStatusCode.Created, schedule.StatusCode);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var products = await db.Products.Include(product => product.Parts).Where(product => product.ProductNo == "15792" || product.ProductNo == "15783").ToListAsync();
        Assert.Equal(2, products.Count);
        Assert.All(products, product => Assert.Equal(0.08, product.Parts.Single(part => part.Craft == "移印").LaborPrice, 6));
        var plans = await db.ProductionPlans.Where(plan => plan.OrderId == orderId).ToListAsync();
        Assert.Equal(22, plans.Count);
        Assert.Equal(2, plans.Select(plan => plan.SourcePartId).Distinct().Count());
    }

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
                new { partQtyId, startDate = "2026-08-13", craft = "移印", dailyTarget = 100, laborPrice = 0.12 },
                new { partQtyId, startDate = "2026-08-13", craft = "UV", dailyTarget = 125, laborPrice = 0.34 },
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
        Assert.Equal(0.12, savedRules.Single(part => part.Craft == "移印").LaborPrice, 6);
        Assert.Equal(0.34, savedRules.Single(part => part.Craft == "UV").LaborPrice, 6);
        Assert.All(savedRules, part => Assert.Equal(2, part.CraftPasses));
        Assert.Equal(0.2, savedRules.Sum(part => part.UnitCost), 6);
    }
}
