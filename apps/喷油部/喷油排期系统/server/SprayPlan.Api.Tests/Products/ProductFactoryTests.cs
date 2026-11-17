using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

public class ProductFactoryTests : IAsyncLifetime
{
    readonly ApiFactory factory = new();
    HttpClient x = null!, h = null!;
    async Task<HttpClient> Login(string factoryId, string username = "admin", string password = "admin123")
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var login = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        login.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Add("Cookie", login.Headers.GetValues("Set-Cookie").First().Split(';')[0] + "; sprayplan_factory=" + factoryId);
        return client;
    }
    public async Task InitializeAsync() { _ = factory.CreateClient(); await factory.SeedAsync(); x = await Login("XINGXIN"); h = await Login("HUADENG"); }
    public Task DisposeAsync() { x.Dispose(); h.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    static async Task<JsonElement> Create(HttpClient client, string no, double cost = 1)
    {
        var response = await client.PostAsJsonAsync("/api/products", new { productNo = no, parts = new[] { new { partName = "头", unitCost = cost, craft = "手喷" } } });
        response.EnsureSuccessStatusCode(); return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task SameNumberHasIndependentPricingAndDetailsInEachFactory()
    {
        var a = (await Create(x, "SAME", 1)).GetProperty("id").GetInt32();
        var b = (await Create(h, "SAME", 9)).GetProperty("id").GetInt32();
        Assert.NotEqual(a, b);
        var xl = await x.GetFromJsonAsync<JsonElement>("/api/products");
        var hl = await h.GetFromJsonAsync<JsonElement>("/api/products");
        Assert.Equal(a, Assert.Single(xl.EnumerateArray()).GetProperty("id").GetInt32());
        Assert.Equal(9, Assert.Single(hl.EnumerateArray()).GetProperty("totalUnitCost").GetDouble());
        Assert.Equal(HttpStatusCode.NotFound, (await x.GetAsync($"/api/products/{b}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await h.GetAsync($"/api/products/{a}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await x.PostAsJsonAsync("/api/products", new { productNo = "SAME" })).StatusCode);
    }

    [Theory]
    [InlineData("head")]
    [InlineData("delete")]
    [InlineData("part")]
    [InlineData("delete-part")]
    [InlineData("add-part")]
    [InlineData("table")]
    public async Task ForeignFactoryWritesAreRejected(string action)
    {
        var id = (await Create(h, "FOREIGN", 9)).GetProperty("id").GetInt32();
        var detail = await h.GetFromJsonAsync<JsonElement>($"/api/products/{id}");
        var part = detail.GetProperty("parts")[0].GetProperty("id").GetInt32();
        var response = action switch {
            "head" => await x.PatchAsJsonAsync($"/api/products/{id}", new { status = "active" }),
            "delete" => await x.DeleteAsync($"/api/products/{id}"),
            "part" => await x.PatchAsJsonAsync($"/api/products/{id}/parts/{part}", new { unitCost = 99 }),
            "delete-part" => await x.DeleteAsync($"/api/products/{id}/parts/{part}"),
            "add-part" => await x.PostAsJsonAsync($"/api/products/{id}/parts", new { partName = "脚" }),
            _ => await x.PatchAsJsonAsync($"/api/products/{id}/parts", new { parts = new[] { new { id = part, partName = "头", unitCost = 99 } } }),
        };
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(detail.ToString(), (await h.GetFromJsonAsync<JsonElement>($"/api/products/{id}")).ToString());
    }

    [Fact]
    public async Task ImportCreatesInCurrentFactoryAndRejectsStaleForeignPreview()
    {
        var id = (await Create(x, "IMPORT")).GetProperty("id").GetInt32();
        object Payload(int? existing) => new { products = new[] { new { productNo = "IMPORT", existingProductId = existing,
            parts = new[] { new { itemName = "", partName = "头", craft = "手喷", craftDetail = "喷油", dailyCapacity = 100, stdMachineCount = 1,
                laborPrice = 1, unitCost = 7, paintCost = 1, quotedPrice = 9 } } } } };
        Assert.Equal(HttpStatusCode.Conflict, (await h.PostAsJsonAsync("/api/products/import/commit", Payload(id))).StatusCode);
        (await h.PostAsJsonAsync("/api/products/import/commit", Payload(null))).EnsureSuccessStatusCode();
        Assert.Equal(7, Assert.Single((await h.GetFromJsonAsync<JsonElement>("/api/products")).EnumerateArray()).GetProperty("totalUnitCost").GetDouble());
        Assert.Equal(1, Assert.Single((await x.GetFromJsonAsync<JsonElement>("/api/products")).EnumerateArray()).GetProperty("totalUnitCost").GetDouble());
    }

    [Fact]
    public async Task RecycleBinAndClerkCookieStayFactoryScoped()
    {
        var a = (await Create(x, "X-ARCHIVE")).GetProperty("id").GetInt32();
        var b = (await Create(h, "H-ARCHIVE")).GetProperty("id").GetInt32();
        (await x.DeleteAsync($"/api/products/{a}")).EnsureSuccessStatusCode();
        (await h.DeleteAsync($"/api/products/{b}")).EnsureSuccessStatusCode();
        (await x.DeleteAsync("/api/products/recycle-bin")).EnsureSuccessStatusCode();
        Assert.Equal("archived", (await h.GetFromJsonAsync<JsonElement>($"/api/products/{b}")).GetProperty("status").GetString());
        using var clerk = await Login("HUADENG", "clerk", "clerk123");
        Assert.Empty((await clerk.GetFromJsonAsync<JsonElement>("/api/products")).EnumerateArray());
        var created = (await Create(clerk, "CLERK")).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.NotFound, (await h.GetAsync($"/api/products/{created}")).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LegacyMigrationSplitsSharedReferencesAndPreservesHistory_Idempotently(bool failFirst)
    {
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "SHARED", CreatedBy = "clerk", Parts = [new() { PartName = "头", UnitCost = 3, Craft = "手喷", IsTumbler = true }] };
            var hdOnly = new Product { ProductNo = "HD-ONLY", CreatedBy = "unknown" };
            db.Products.AddRange(product, hdOnly); await db.SaveChangesAsync();
            var part = product.Parts.Single(); part.PartGroupId = part.Id;
            var order = new Order { ExternalOrderNo = "H-ORDER", FactoryId = "HUADENG", ProductId = product.Id,
                PartQtys = [new() { PartName = "头", Qty = 500, SourcePartId = part.Id }] };
            db.Orders.AddRange(order, new() { ExternalOrderNo = "H-ONLY", FactoryId = "HUADENG", ProductId = hdOnly.Id });
            await db.SaveChangesAsync();
            db.ProductionPlans.Add(new() { OrderId = order.Id, LineId = 1, FactoryId = "HUADENG", PartName = "头", SourcePartId = part.Id,
                PlannedQty = 100, GoodQty = 90, InboundQty = 80, ReportedQty = 95, Status = "recorded", ProductionValue = 270, ModificationHistory = "[1]" });
            db.InventoryMoves.Add(new() { ProductId = product.Id, FactoryId = "HUADENG", PartName = "头", Delta = 80, Reason = "history" });
            await db.SaveChangesAsync(); db.ChangeTracker.Clear();
            await db.Database.ExecuteSqlRawAsync("DROP INDEX IX_products_FactoryId_ProductNo; ALTER TABLE products DROP COLUMN factoryId; CREATE UNIQUE INDEX products_productNo_key ON products(productNo);");
            if (failFirst)
            {
                await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER reject_copy BEFORE INSERT ON products BEGIN SELECT RAISE(ABORT, 'simulated migration failure'); END;");
                await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() => ProductFactorySchema.Ensure(db));
                await db.Database.ExecuteSqlRawAsync("DROP TRIGGER reject_copy;");
                // 再次执行成功也验证了失败时 ADD COLUMN、索引及数据复制均已回滚。
            }
            await ProductFactorySchema.Ensure(db);
            var products = await db.Products.Include(p => p.Parts).OrderBy(p => p.Id).ToListAsync();
            Assert.Equal(3, products.Count);
            Assert.Equal("HUADENG", products.Single(p => p.ProductNo == "HD-ONLY").FactoryId);
            var clone = products.Single(p => p.ProductNo == "SHARED" && p.FactoryId == "HUADENG");
            Assert.NotEqual(product.Id, clone.Id);
            var newPart = Assert.Single(clone.Parts);
            Assert.Equal(newPart.Id, newPart.PartGroupId); Assert.True(newPart.IsTumbler); Assert.Equal(3, newPart.UnitCost);
            var afterOrder = await db.Orders.Include(o => o.PartQtys).SingleAsync(o => o.Id == order.Id);
            Assert.Equal(clone.Id, afterOrder.ProductId); Assert.Equal(newPart.Id, afterOrder.PartQtys.Single().SourcePartId);
            Assert.Equal(500, afterOrder.PartQtys.Single().Qty);
            var plan = await db.ProductionPlans.SingleAsync();
            Assert.Equal(newPart.Id, plan.SourcePartId); Assert.Equal(90, plan.GoodQty); Assert.Equal(80, plan.InboundQty);
            Assert.Equal(270, plan.ProductionValue); Assert.Equal("[1]", plan.ModificationHistory);
            var move = await db.InventoryMoves.SingleAsync(); Assert.Equal(clone.Id, move.ProductId); Assert.Equal(80, move.Delta);
            await ProductFactorySchema.Ensure(db);
            Assert.Equal(3, await db.Products.CountAsync()); Assert.Equal(2, await db.ProductParts.CountAsync());
        });
    }
}
