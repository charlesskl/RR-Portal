using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderPartDemandBoundaryTests : IAsyncLifetime
{
    private ApiFactory factory = null!;
    private HttpClient client = null!;
    private int productId;

    public async Task InitializeAsync()
    {
        factory = new ApiFactory();
        client = factory.CreateClient();
        await factory.SeedAsync();
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "DEMAND-BOUNDARY" };
            db.Products.Add(product);
            await db.SaveChangesAsync();
            productId = product.Id;
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
    }

    public Task DisposeAsync()
    {
        client.Dispose();
        factory.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public async Task RemovingLastPositiveDemand_WithLegacyNegativePart_IsRejectedAtomically()
    {
        // The existing create endpoint accepts a negative part, so this legacy shape
        // is reachable without bypassing the application's public API.
        var created = await client.PostAsJsonAsync("/api/orders", new {
            externalOrderNo = "LEGACY-NEGATIVE", productId,
            partQtys = new[] { new { partName = "头", qty = 100 }, new { partName = "脚", qty = -1 } }
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var orderId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var before = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        var headId = before.GetProperty("partQtys").EnumerateArray().Single(part => part.GetProperty("partName").GetString() == "头").GetProperty("id").GetInt32();

        var response = await client.PatchAsJsonAsync($"/api/orders/{orderId}", new {
            partQtys = new[] { new { id = headId, qty = 0 } }, remark = "must not persist"
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await factory.WithDbAsync(async db => {
            var order = await db.Orders.Include(order => order.PartQtys).SingleAsync(order => order.Id == orderId);
            Assert.Null(order.Remark);
            Assert.Equal("draft", order.Status);
            Assert.Equal(100, order.PartQtys.Single(part => part.Id == headId).Qty);
            Assert.Equal(-1, order.PartQtys.Single(part => part.PartName == "脚").Qty);
        });
    }

    [Theory]
    [InlineData("manager")]
    [InlineData("admin")]
    public async Task SameNameRows_EditOnlySelectedId_AndPreserveAllHistory(string role)
    {
        int orderId = 0, editedId = 0, untouchedId = 0;
        async Task<string> Snapshot()
        {
            string snapshot = "";
            await factory.WithDbAsync(async db => snapshot = JsonSerializer.Serialize(new {
                Plans = await db.ProductionPlans.AsNoTracking().OrderBy(plan => plan.Id).ToListAsync(),
                Moves = await db.InventoryMoves.AsNoTracking().OrderBy(move => move.Id).ToListAsync(),
                Applications = await db.InboundApplications.AsNoTracking().OrderBy(application => application.Id).ToListAsync()
            }));
            return snapshot;
        }
        await factory.WithDbAsync(async db => {
            if (role == "manager") {
                db.Users.Add(new User { Username = "manager", PasswordHash = PasswordService.Hash("manager123"), Role = "manager", IsActive = true });
            }
            var order = new Order { ExternalOrderNo = "SAME-NAME-ROWS", ProductId = productId, Status = "in_production",
                PartQtys = new() { new() { PartName = "头", Qty = 60 }, new() { PartName = "头", Qty = 40 }, new() { PartName = "脚", Qty = 20 } } };
            db.Orders.Add(order); await db.SaveChangesAsync();
            orderId = order.Id; editedId = order.PartQtys[0].Id; untouchedId = order.PartQtys[1].Id;
            var lineId = await db.ProductionLines.Select(line => line.Id).FirstAsync();
            ProductionPlan Plan(string part, int step, int planned, int? good) => new() {
                OrderId = orderId, LineId = lineId, PartName = part, StepNo = step,
                PlannedQty = planned, GoodQty = good, InboundQty = good, ProductionValue = 177.5,
                Status = good.HasValue ? "recorded" : "planned", ModificationHistory = "[{\"from\":9,\"to\":10}]"
            };
            var head = Plan("头", 1, 100, 60);
            var foot = Plan("脚", 1, 20, 20);
            var deleted = Plan("头", 2, 999, 999); deleted.DeletedAt = DateTime.UtcNow;
            db.ProductionPlans.AddRange(head, Plan("头", 1, 100, null), Plan("头", 2, 100, 40), foot, deleted);
            db.InventoryMoves.Add(new InventoryMove { ProductId = productId, OwnerOrderId = orderId, PartName = "脚", Delta = -2, Reason = "assembly_pickup" });
            await db.SaveChangesAsync();
            db.InboundApplications.Add(new InboundApplication { ApplicationNo = "BOUNDARY-APP", SourcePlanId = foot.Id,
                OrderNo = order.ExternalOrderNo, ProductNo = "DEMAND-BOUNDARY", PartName = "脚", Quantity = 20 });
            await db.SaveChangesAsync();
        });
        var before = await Snapshot();
        var inventory = await client.GetStringAsync("/api/inventory/query");
        (await client.PostAsJsonAsync("/api/auth/login", new { username = role, password = role + "123" })).EnsureSuccessStatusCode();

        (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys = new[] { new { id = editedId, qty = 90 } } })).EnsureSuccessStatusCode();

        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        Assert.Equal(40, detail.GetProperty("partQtys").EnumerateArray().Single(part => part.GetProperty("id").GetInt32() == untouchedId).GetProperty("qty").GetInt32());
        var steps = detail.GetProperty("scheduleBalances").EnumerateArray().Where(part => part.GetProperty("partName").GetString() == "头").ToArray();
        Assert.Equal(2, steps.Length);
        Assert.All(steps, step => Assert.Equal(130, step.GetProperty("demandQty").GetInt32()));
        Assert.Equal(30, steps[0].GetProperty("reduceQty").GetInt32());
        Assert.Equal(90, steps[1].GetProperty("supplementQty").GetInt32());
        var overview = (await client.GetFromJsonAsync<JsonElement>("/api/orders/overview"))[0];
        Assert.Equal(130, overview.GetProperty("demandQty").GetInt32());
        Assert.Equal(90, overview.GetProperty("remainingQty").GetInt32());
        Assert.Equal(31, overview.GetProperty("progressPct").GetInt32());
        Assert.False(overview.GetProperty("scheduleCovered").GetBoolean());
        Assert.Equal(before, await Snapshot());
        Assert.Equal(inventory, await client.GetStringAsync("/api/inventory/query"));
    }

    [Theory]
    [InlineData("1.5")]
    [InlineData("2147483648")]
    public async Task NonIntegerOrOutOfRangeQuantity_IsRejectedBeforeSaving(string quantity)
    {
        var created = await client.PostAsJsonAsync("/api/orders", new { externalOrderNo = "INVALID-JSON-QTY", productId,
            partQtys = new[] { new { partName = "头", qty = 1 } } });
        created.EnsureSuccessStatusCode();
        var orderId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        var partId = detail.GetProperty("partQtys")[0].GetProperty("id").GetInt32();
        using var body = new StringContent($"{{\"remark\":\"must not persist\",\"partQtys\":[{{\"id\":{partId},\"qty\":{quantity}}}]}}", System.Text.Encoding.UTF8, "application/json");

        var response = await client.PatchAsync($"/api/orders/{orderId}", body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await factory.WithDbAsync(async db => {
            Assert.Equal(1, (await db.OrderPartQtys.SingleAsync(part => part.Id == partId)).Qty);
            Assert.Null((await db.Orders.SingleAsync(order => order.Id == orderId)).Remark);
        });
    }
}
