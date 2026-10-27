using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderPartDemandEditTests : IAsyncLifetime
{
    private ApiFactory factory = null!;
    private HttpClient client = null!;
    private int orderId, headId, footId;
    private string history = "", stock = "";

    public async Task InitializeAsync()
    {
        factory = new ApiFactory(); client = factory.CreateClient(); await factory.SeedAsync();
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "PART-EDIT", Parts = new() { new() { PartName = "头" }, new() { PartName = "脚" } } };
            db.Products.Add(product); await db.SaveChangesAsync();
            var order = new Order { ExternalOrderNo = "PART-EDIT-1", ProductId = product.Id,
                Status = "in_production", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 50 } } };
            db.Orders.Add(order); await db.SaveChangesAsync();
            orderId = order.Id; headId = order.PartQtys[0].Id; footId = order.PartQtys[1].Id;
            var lineId = await db.ProductionLines.Select(line => line.Id).FirstAsync();
            ProductionPlan Plan(string name, int step, int planned, int? good, int? inbound = null) => new() {
                OrderId = orderId, LineId = lineId, PartName = name, StepNo = step, Craft = step == 1 ? "喷油" : "移印",
                PlanDate = DateTime.UtcNow.Date, PlannedQty = planned, GoodQty = good, InboundQty = inbound,
                Status = good.HasValue ? "recorded" : "planned", ProductionValue = good.GetValueOrDefault() * 2,
                ModificationHistory = "[]", CreatedBy = "original" };
            db.ProductionPlans.AddRange(Plan("头", 1, 60, 60), Plan("头", 1, 40, null),
                Plan("头", 2, 60, 40, 30), Plan("头", 2, 40, null), Plan("脚", 1, 50, 50, 45));
            db.InventoryMoves.Add(new InventoryMove { ProductId = product.Id, PartName = "脚", OwnerOrderId = orderId, Delta = -5, Reason = "assembly_pickup" });
            await db.SaveChangesAsync();
        });
        await Login("clerk", "clerk123");
        history = await Snapshot();
        stock = await client.GetStringAsync("/api/inventory/query");
    }
    private async Task Login(string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
    private async Task<string> Snapshot()
    {
        string result = "";
        await factory.WithDbAsync(async db => result = JsonSerializer.Serialize(new {
            Plans = await db.ProductionPlans.AsNoTracking().Where(p => p.OrderId == orderId).OrderBy(p => p.Id).ToListAsync(),
            Moves = await db.InventoryMoves.AsNoTracking().OrderBy(m => m.Id).ToListAsync()
        }));
        return result;
    }
    private async Task<JsonElement> Detail() => await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
    private Task<HttpResponseMessage> Update(int qty) => client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys = new[] { new { id = headId, qty } } });
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }

    [Fact]
    public async Task IncreaseOnePart_UpdatesOverviewAndStepGaps_LeavesOtherPartAndHistoryUnchanged()
    {
        (await Update(120)).EnsureSuccessStatusCode();
        var detail = await Detail();
        Assert.True(detail.GetProperty("qtyEditable").GetBoolean());
        Assert.Equal(50, detail.GetProperty("partQtys").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == footId).GetProperty("qty").GetInt32());
        var steps = detail.GetProperty("scheduleBalances").EnumerateArray().Where(p => p.GetProperty("partName").GetString() == "头").ToArray();
        Assert.Equal(new[] { 20, 40 }, steps.Select(p => p.GetProperty("supplementQty").GetInt32()));
        Assert.Equal("in_production", detail.GetProperty("status").GetString());
        var overview = (await client.GetFromJsonAsync<JsonElement>("/api/orders/overview"))[0];
        Assert.Equal(120, overview.GetProperty("demandQty").GetInt32());
        Assert.Equal(80, overview.GetProperty("remainingQty").GetInt32());
        Assert.False(overview.GetProperty("scheduleCovered").GetBoolean());
        Assert.Equal(history, await Snapshot()); Assert.Equal(stock, await client.GetStringAsync("/api/inventory/query"));
    }

    [Fact]
    public async Task DecreaseBelowActuals_CompletesOrder_ShowsOnlyUnreportedReductionAndOverproduction()
    {
        (await Update(30)).EnsureSuccessStatusCode();
        var detail = await Detail();
        Assert.Equal("completed", detail.GetProperty("status").GetString());
        var steps = detail.GetProperty("scheduleBalances").EnumerateArray().Where(p => p.GetProperty("partName").GetString() == "头").ToArray();
        Assert.All(steps, step => Assert.Equal(40, step.GetProperty("reduceQty").GetInt32()));
        Assert.Equal(new[] { 30, 10 }, steps.Select(p => p.GetProperty("overproducedQty").GetInt32()));
        var overview = (await client.GetFromJsonAsync<JsonElement>("/api/orders/overview"))[0];
        Assert.Equal(0, overview.GetProperty("remainingQty").GetInt32());
        Assert.Equal(100, overview.GetProperty("progressPct").GetInt32());
        Assert.Equal(history, await Snapshot()); Assert.Equal(stock, await client.GetStringAsync("/api/inventory/query"));
        (await Update(120)).EnsureSuccessStatusCode();
        Assert.Equal("in_production", (await Detail()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task ZeroOnePart_PreservesActualsAndIgnoresCancelledDemandForCompletion()
    {
        (await Update(0)).EnsureSuccessStatusCode();
        Assert.Equal("completed", (await Detail()).GetProperty("status").GetString());
        Assert.Equal(history, await Snapshot()); Assert.Equal(stock, await client.GetStringAsync("/api/inventory/query"));
        var result = await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys = new[] { new { id = footId, qty = 0 } } });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
    }

    [Fact]
    public async Task UnchangedQuantity_DoesNotReclassifyHistoricalStatus()
    {
        await factory.WithDbAsync(async db => { (await db.Orders.SingleAsync(o => o.Id == orderId)).Status = "completed"; await db.SaveChangesAsync(); });
        (await Update(100)).EnsureSuccessStatusCode();
        Assert.Equal("completed", (await Detail()).GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("negative")]
    [InlineData("duplicate")]
    [InlineData("unknown")]
    [InlineData("foreign")]
    [InlineData("overflow")]
    public async Task InvalidUpdates_AreAtomic(string kind)
    {
        var foreignId = 0;
        await factory.WithDbAsync(async db => {
            var other = new Order { ExternalOrderNo = "OTHER", PartQtys = new() { new() { PartName = "头", Qty = 1 } } };
            db.Orders.Add(other); await db.SaveChangesAsync(); foreignId = other.PartQtys[0].Id;
            if (kind == "overflow") { db.OrderPartQtys.Add(new() { OrderId = orderId, PartName = "头", Qty = 1 }); await db.SaveChangesAsync(); }
        });
        var partQtys = kind switch {
            "negative" => new[] { new { id = headId, qty = -1 } },
            "duplicate" => new[] { new { id = headId, qty = 2 }, new { id = headId, qty = 3 } },
            "unknown" => new[] { new { id = headId, qty = 2 }, new { id = int.MaxValue, qty = 4 } },
            "foreign" => new[] { new { id = headId, qty = 2 }, new { id = foreignId, qty = 4 } },
            _ => new[] { new { id = headId, qty = int.MaxValue } }
        };
        var response = await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys, deliveryDate = "2030-01-01" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var detail = await Detail();
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("deliveryDate").ValueKind);
        Assert.Equal(100, detail.GetProperty("partQtys").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == headId).GetProperty("qty").GetInt32());
        Assert.Equal(history, await Snapshot());
    }

    [Fact]
    public async Task ViewerAndOtherFactory_CannotModifyQuantity()
    {
        await Login("viewer", "viewer123"); Assert.Equal(HttpStatusCode.Forbidden, (await Update(120)).StatusCode);
        await Login("clerk", "clerk123");
        await factory.WithDbAsync(async db => { (await db.Orders.SingleAsync(o => o.Id == orderId)).FactoryId = "HUADENG"; await db.SaveChangesAsync(); });
        Assert.Equal(HttpStatusCode.NotFound, (await Update(120)).StatusCode);
    }

    [Theory]
    [InlineData("archived", false)]
    [InlineData("received", true)]
    public async Task ArchivedOrPendingOrder_IsReadOnly(string status, bool pending)
    {
        await factory.WithDbAsync(async db => { var order = await db.Orders.SingleAsync(o => o.Id == orderId); order.Status = status; order.PendingProduct = pending; await db.SaveChangesAsync(); });
        Assert.False((await Detail()).GetProperty("qtyEditable").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await Update(120)).StatusCode);
    }
}
