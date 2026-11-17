using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Orders;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests.Orders;

public class ImportFactoryTests : IAsyncLifetime
{
    sealed class FixtureReader : IOrderDocumentReader
    {
        public string Header = "华登";
        public bool Multi;
        public List<PdfWord> Read(string token)
        {
            var file = Multi ? "words_xingxin_purchase_price_change.json" : "words_11494_p1.json";
            var words = JsonSerializer.Deserialize<List<PdfWord>>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", file)), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            words.RemoveAll(w => w.Text.Contains("华登") || w.Text.Contains("兴信"));
            words.Add(new(1, Header + "委托加工合同", 10, 200, 1000, 1010));
            return words;
        }
    }
    readonly FixtureReader reader = new();
    ApiFactory factory = null!;
    HttpClient x = null!, h = null!;
    async Task<HttpClient> Login(string selected)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = "admin123" }); response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Add("Cookie", response.Headers.GetValues("Set-Cookie").First().Split(';')[0] + "; sprayplan_factory=" + selected);
        return client;
    }
    public async Task InitializeAsync()
    {
        factory = new(configureServices: services => services.AddSingleton<IOrderDocumentReader>(reader));
        _ = factory.CreateClient(); await factory.SeedAsync(); x = await Login("XINGXIN"); h = await Login("HUADENG");
        var names = PdfImportParse.BuildDraftLines(PdfTableExtractor.ExtractRows(reader.Read("test"))).Select(l => l.NormalizedName).Append("头").Distinct().ToList();
        await factory.WithDbAsync(async db => {
            foreach (var area in new[] { "XINGXIN", "HUADENG" }) foreach (var number in new[] { "11494", "995159", "096283" })
                db.Products.Add(new() { ProductNo = number, FactoryId = area, Parts = names.Select(name => new ProductPart { PartName = name, UnitCost = area == "HUADENG" ? 9 : 1 }).ToList() });
            await db.SaveChangesAsync();
        });
    }
    public Task DisposeAsync() { x.Dispose(); h.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    object Single(string? source = "HUADENG", string? target = "XINGXIN", int qty = 20, bool pending = false, string token = "fixture.pdf") => new {
        head = new { externalOrderNo = "CROSS", orderDate = "2026-11-17", deliveryDate = "2026-12-01", productNo = "11494", isMa = false },
        pdfToken = token, asPendingProduct = pending, savePricing = !pending, sourceFactoryId = source, targetFactoryId = target,
        lines = new[] { new { matchedItemName = "头", totalQty = qty, unitPrice = 2.5 } }
    };
    async Task<JsonElement> Upload(HttpClient client)
    {
        using var form = new MultipartFormDataContent(); form.Add(new ByteArrayContent([1, 2, 3]), "file", "contract.pdf");
        var response = await client.PostAsync("/api/orders/import-pdf", form); response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Theory]
    [InlineData("华登", "HUADENG", "XINGXIN", false)]
    [InlineData("华登", "HUADENG", "XINGXIN", true)]
    [InlineData("兴信", "XINGXIN", "HUADENG", false)]
    [InlineData("华登兴信", null, "XINGXIN", false)]
    [InlineData("未注明", null, "HUADENG", false)]
    public async Task PdfHeaderIsSourceOnly_SelectedFactoryOwnsDraft(string header, string? source, string target, bool multi)
    {
        reader.Header = header; reader.Multi = multi;
        var draft = await Upload(target == "HUADENG" ? h : x);
        Assert.Equal(source, draft.GetProperty("sourceFactoryId").GetString());
        Assert.Equal(target, draft.GetProperty("targetFactoryId").GetString());
        Assert.True(multi ? draft.GetProperty("products").GetArrayLength() == 2 : draft.GetProperty("productFound").GetBoolean());
    }

    [Fact]
    public async Task CrossFactoryImportAndDuplicateMergeAppendExactAcceptedQuantities_LeaveOtherFactoryUnchanged()
    {
        await factory.WithDbAsync(async db => {
            var product = await db.Products.SingleAsync(p => p.FactoryId == "HUADENG" && p.ProductNo == "11494");
            var order = new Order { ExternalOrderNo = "CROSS", FactoryId = "HUADENG", ProductId = product.Id, Status = "in_production", PartQtys = [new() { PartName = "头", Qty = 100 }] };
            db.Orders.Add(order); await db.SaveChangesAsync();
            db.ProductionPlans.Add(new() { OrderId = order.Id, FactoryId = "HUADENG", LineId = 1, PartName = "头", PlannedQty = 30, GoodQty = 25, Status = "recorded", ModificationHistory = "[1]" });
            db.InventoryMoves.Add(new() { ProductId = product.Id, FactoryId = "HUADENG", Delta = 25, PartName = "头" }); await db.SaveChangesAsync();
        });
        var response = await x.PostAsJsonAsync("/api/orders/import-confirm", Single(qty: 20)); response.EnsureSuccessStatusCode();
        var id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        (await x.PostAsJsonAsync("/api/orders/import-confirm", Single(source: "XINGXIN", qty: 5))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var target = await db.Orders.Include(o => o.PartQtys).SingleAsync(o => o.Id == id);
            Assert.Equal("XINGXIN", target.FactoryId); Assert.Equal(25, target.PartQtys.Single().Qty);
            var receipts = await db.OrderImportReceipts.OrderBy(r => r.Id).ToListAsync();
            Assert.Equal(new long[] { 20, 5 }, receipts.Select(r => r.AcceptedQty));
            Assert.Equal(new[] { "HUADENG", "XINGXIN" }, receipts.Select(r => r.SourceFactoryId));
            Assert.All(receipts, r => Assert.Equal("XINGXIN", r.FactoryId));
            Assert.Equal(100, (await db.OrderPartQtys.SingleAsync(q => q.Order!.FactoryId == "HUADENG")).Qty);
            Assert.Equal(25, (await db.ProductionPlans.SingleAsync()).GoodQty); Assert.Equal("[1]", (await db.ProductionPlans.SingleAsync()).ModificationHistory);
            Assert.Equal(25, (await db.InventoryMoves.SingleAsync()).Delta);
            Assert.All(await db.ProductParts.Where(p => p.Product!.FactoryId == "HUADENG").ToListAsync(), p => Assert.Equal(9, p.UnitCost));
        });
        var detail = await x.GetFromJsonAsync<JsonElement>($"/api/orders/{id}");
        Assert.Equal(2, detail.GetProperty("importReceipts").GetArrayLength());
        Assert.Equal(5, detail.GetProperty("importReceipts")[0].GetProperty("parts")[0].GetProperty("qty").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await h.GetAsync($"/api/orders/{id}")).StatusCode);
    }

    [Fact]
    public async Task ClerkCanRecordForeignSourceButCannotChangeTheirFactoryWithCookie()
    {
        using var clerk = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var login = await clerk.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" }); login.EnsureSuccessStatusCode();
        clerk.DefaultRequestHeaders.Add("Cookie", login.Headers.GetValues("Set-Cookie").First().Split(';')[0] + "; sprayplan_factory=HUADENG");
        (await clerk.PostAsJsonAsync("/api/orders/import-confirm", Single())).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.Equal("XINGXIN", (await db.Orders.SingleAsync()).FactoryId);
            var receipt = await db.OrderImportReceipts.SingleAsync(); Assert.Equal("XINGXIN", receipt.FactoryId);
            Assert.Equal("HUADENG", receipt.SourceFactoryId); Assert.Equal("clerk", receipt.CreatedBy);
        });
    }

    [Fact]
    public async Task MultiProductImportRecordsOnlyCurrentBatchAndAllProducts()
    {
        var payload = new { head = new { externalOrderNo = "MULTI-CROSS", orderDate = "2026-11-17", productNo = "11494", isMa = false },
            pdfToken = "multi.pdf", savePricing = false, sourceFactoryId = "HUADENG", targetFactoryId = "XINGXIN",
            products = new[] { new { productNo = "11494", isMa = false, lines = new[] { new { matchedItemName = "头", totalQty = 10 } } },
                new { productNo = "995159", isMa = false, lines = new[] { new { matchedItemName = "头", totalQty = 30 } } } } };
        (await x.PostAsJsonAsync("/api/orders/import-confirm-multi", payload)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => { var receipt = await db.OrderImportReceipts.SingleAsync(); Assert.Equal(40, receipt.AcceptedQty);
            Assert.Contains("995159", receipt.Details); Assert.Equal(2, (await db.OrderPartQtys.ToListAsync()).Count); });
    }

    [Theory]
    [InlineData("ALL", "XINGXIN", 20, 400)]
    [InlineData("HUADENG", "HUADENG", 20, 409)]
    [InlineData("HUADENG", "XINGXIN", -1, 400)]
    public async Task InvalidSourceOrSwitchedFactoryOrNegativeQuantityNeverWrites(string source, string target, int qty, int status)
    {
        Assert.Equal(status, (int)(await x.PostAsJsonAsync("/api/orders/import-confirm", Single(source, target, qty))).StatusCode);
        await factory.WithDbAsync(async db => { Assert.Empty(await db.Orders.ToListAsync()); Assert.Empty(await db.OrderImportReceipts.ToListAsync()); });
    }

    [Fact]
    public async Task PendingImportConfirmsReceiptOnContinueWithoutDoubleCounting()
    {
        var draft = await Upload(x); var token = draft.GetProperty("pdfToken").GetString()!;
        var response = await x.PostAsJsonAsync("/api/orders/import-confirm", Single(pending: true, token: token)); response.EnsureSuccessStatusCode();
        var id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        await factory.WithDbAsync(async db => { var receipt = await db.OrderImportReceipts.SingleAsync(); Assert.True(receipt.PendingDetails); Assert.Equal(0, receipt.AcceptedQty); });
        int productId = 0;
        await factory.WithDbAsync(async db => productId = (await db.Products.SingleAsync(p => p.FactoryId == "XINGXIN" && p.ProductNo == "11494")).Id);
        (await x.PostAsJsonAsync($"/api/orders/{id}/continue-parse", new { productId })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => { var receipt = await db.OrderImportReceipts.SingleAsync(); Assert.False(receipt.PendingDetails);
            Assert.True(receipt.AcceptedQty > 0); Assert.Equal("HUADENG", receipt.SourceFactoryId); Assert.Equal((await db.OrderPartQtys.SumAsync(q => (long)q.Qty)), receipt.AcceptedQty); });
    }

    [Fact]
    public async Task ReceiptFailureRollsBackOrderQuantitiesAndPricing()
    {
        await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_receipt BEFORE INSERT ON order_import_receipts BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END;"));
        try { Assert.Equal(HttpStatusCode.InternalServerError, (await x.PostAsJsonAsync("/api/orders/import-confirm", Single())).StatusCode); }
        catch (DbUpdateException) { }
        await factory.WithDbAsync(async db => { Assert.Empty(await db.Orders.ToListAsync()); Assert.Empty(await db.OrderImportReceipts.ToListAsync());
            Assert.All(await db.ProductParts.Where(p => p.Product!.FactoryId == "XINGXIN").ToListAsync(), p => Assert.Equal(1, p.UnitCost)); });
    }

    [Fact]
    public async Task ExistingDatabaseReceiptUpgradeIsIdempotent()
    {
        await factory.WithDbAsync(async db => {
            await db.Database.ExecuteSqlRawAsync("DROP TABLE order_import_receipts;");
            await OrderImportReceiptSchema.Ensure(db); await OrderImportReceiptSchema.Ensure(db);
            Assert.Equal(6, await db.Products.CountAsync());
        });
        (await x.PostAsJsonAsync("/api/orders/import-confirm", Single(source: null))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => { var receipt = await db.OrderImportReceipts.SingleAsync(); Assert.Null(receipt.SourceFactoryId); Assert.Equal(20, receipt.AcceptedQty); });
    }
}
