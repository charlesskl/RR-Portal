using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

public class ProductFactoryMoveTests : IAsyncLifetime
{
    readonly ApiFactory factory = new();
    HttpClient client = null!;
    int a, b;
    public async Task InitializeAsync()
    {
        client = factory.CreateClient(); await factory.SeedAsync();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = "admin123" })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var one = new Product { ProductNo = "MOVE-1", Status = "active", Remark = "保留备注", CreatedBy = "old", Parts = [new() { PartName = "头", Craft = "手喷", UnitCost = 3, DailyCapacity = 1000 }] };
            var two = new Product { ProductNo = "MOVE-2", Status = "archived" };
            db.Products.AddRange(one, two); await db.SaveChangesAsync(); a = one.Id; b = two.Id;
        });
    }
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    Task<HttpResponseMessage> Send(int[] ids, bool preview = true, string? token = null, string target = "HUADENG")
        => client.PostAsJsonAsync("/api/products/factory-move", new { ids, targetFactoryId = target, preview, previewToken = token });
    async Task<string> Token(int[] ids)
    {
        var response = await Send(ids); response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("previewToken").GetString()!;
    }
    async Task AssertStillInXingxin()
        => await factory.WithDbAsync(async db => Assert.All(await db.Products.ToListAsync(), p => { if (p.Id == a || p.Id == b) Assert.Equal("XINGXIN", p.FactoryId); }));

    [Fact]
    public async Task PreviewIsReadOnlyAndBatchMovesActiveAndArchivedWithoutChangingPricing()
    {
        var token = await Token([a, b]); await AssertStillInXingxin();
        var response = await Send([b, a], false, token); response.EnsureSuccessStatusCode();
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("moved").GetInt32());
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>("/api/products")).EnumerateArray());
        await factory.WithDbAsync(async db => {
            var products = await db.Products.Include(p => p.Parts).ToListAsync();
            Assert.All(products, p => { Assert.Equal("HUADENG", p.FactoryId); Assert.Equal("admin", p.LastUpdatedBy); });
            var one = products.Single(p => p.Id == a); Assert.Equal("active", one.Status); Assert.Equal("保留备注", one.Remark); Assert.Equal("old", one.CreatedBy);
            var part = Assert.Single(one.Parts); Assert.Equal(3, part.UnitCost); Assert.Equal(1000, part.DailyCapacity);
            Assert.Equal("archived", products.Single(p => p.Id == b).Status);
        });
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a, b], false, token)).StatusCode);
    }

    [Theory]
    [InlineData("clerk")]
    [InlineData("viewer")]
    [InlineData("manager")]
    public async Task OnlyAdminsCanPreviewOrCommit(string role)
    {
        await factory.WithDbAsync(async db => { (await db.Users.SingleAsync(u => u.Username == "clerk")).Role = role; await db.SaveChangesAsync(); });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await Send([a])).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send([a], false, "fake")).StatusCode);
        await AssertStillInXingxin();
    }

    [Theory]
    [InlineData("order")]
    [InlineData("quantity")]
    [InlineData("plan")]
    [InlineData("stock")]
    [InlineData("inbound")]
    [InlineData("collision")]
    public async Task ReferencesInAnyFactoryOrDuplicateNumbersBlockEntireBatch(string kind)
    {
        await factory.WithDbAsync(async db => {
            var part = await db.ProductParts.SingleAsync();
            if (kind == "collision") db.Products.Add(new() { ProductNo = "MOVE-1", FactoryId = "HUADENG", Status = "archived" });
            if (kind == "stock") db.InventoryMoves.Add(new() { ProductId = a, FactoryId = "HUADENG", Delta = 0, Reason = "旧流水" });
            if (kind == "inbound") db.InboundApplications.Add(new() { ApplicationNo = "OLD-INBOUND", ProductNo = "MOVE-1", Quantity = 1 });
            if (kind is "order" or "quantity" or "plan") {
                var order = new Order { ExternalOrderNo = "HISTORY", FactoryId = "HUADENG", ProductId = kind == "order" ? a : null, Status = "archived" };
                if (kind == "quantity") order.PartQtys.Add(new() { SourcePartId = part.Id, PartName = "头", Qty = 0 });
                db.Orders.Add(order); await db.SaveChangesAsync();
                if (kind == "plan") db.ProductionPlans.Add(new() { OrderId = order.Id, LineId = 1, FactoryId = "HUADENG", SourcePartId = part.Id, PlannedQty = 10,
                    Status = "recorded", GoodQty = 8, DeletedAt = DateTime.UtcNow });
            }
            await db.SaveChangesAsync();
        });
        var preview = await Send([a, b]); preview.EnsureSuccessStatusCode();
        var body = await preview.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("canSave").GetBoolean());
        var blocked = body.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetInt32() == a);
        Assert.NotEmpty(blocked.GetProperty("reasons").EnumerateArray());
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a, b], false, body.GetProperty("previewToken").GetString())).StatusCode);
        await AssertStillInXingxin();
        (await Send([b], false, await Token([b]))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => Assert.Equal("XINGXIN", (await db.Products.FindAsync(a))!.FactoryId));
    }

    [Theory]
    [InlineData("price")]
    [InlineData("reference")]
    [InlineData("factory")]
    public async Task ChangedPreviewRejectsSaveAndPreservesBatch(string kind)
    {
        var token = await Token([a, b]);
        await factory.WithDbAsync(async db => {
            if (kind == "price") (await db.ProductParts.SingleAsync()).UnitCost = 99;
            if (kind == "reference") db.InventoryMoves.Add(new() { ProductId = a, Delta = 3 });
            if (kind == "factory") (await db.Products.FindAsync(a))!.FactoryId = "HUADENG";
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a, b], false, token)).StatusCode);
        await factory.WithDbAsync(async db => Assert.Equal("XINGXIN", (await db.Products.FindAsync(b))!.FactoryId));
    }

    [Fact]
    public async Task DatabaseFailureRollsBackAllSelectedProducts()
    {
        var token = await Token([a, b]);
        await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("CREATE TRIGGER reject_factory_move BEFORE UPDATE OF factoryId ON products WHEN OLD.productNo='MOVE-2' BEGIN SELECT RAISE(ABORT, 'simulated move failure'); END;"));
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a, b], false, token)).StatusCode);
        await AssertStillInXingxin();
    }

    [Fact]
    public async Task MissingPreviewInvalidIdsAndInvalidTargetNeverWrite()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a], false)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send([])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send([a, a])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(Enumerable.Range(1, 501).ToArray())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send([a], target: "ALL")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send([a], target: "XINGXIN")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send([a, 999])).StatusCode);
        await AssertStillInXingxin();
    }
}
