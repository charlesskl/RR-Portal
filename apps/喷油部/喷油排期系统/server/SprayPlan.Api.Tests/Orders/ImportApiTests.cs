using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

// PDF 订单导入集成测试：聚焦不依赖真实 PDF 的核心入库逻辑（import-confirm/continue-parse 校验）。
// 真实 PDF 的完整 file→draft 路径（几何解析）已在 Task T 充分测过，这里仅冒烟，缺文件不变红。
public class ImportApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task LoginAsync(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // 直接往测试库种一个产品：货号 + 若干子件（每子件若干部位），返回产品 id。
    // 用 DB 直种而非产品 API，可精确控制子件/部位结构。
    private async Task<int> SeedProductAsync(string productNo, params (string item, string[] parts)[] items)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        var p = new Product
        {
            ProductNo = productNo, IterationNo = "V1", Status = "active",
            CreatedBy = "test", CreatedAt = now, UpdatedAt = now,
            Parts = items.SelectMany(it => it.parts).Distinct().Select((pn, pi) => new ProductPart { PartName = pn, PartOrder = pi }).ToList()
        };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return p.Id;
    }

    // 直接往测试库种一个订单（仅订单头），用于撞号场景。
    private async Task SeedOrderAsync(string externalOrderNo, bool pendingProduct = false, string? remark = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        db.Orders.Add(new Order
        {
            ExternalOrderNo = externalOrderNo, OrderDate = now, Status = "received",
            PendingProduct = pendingProduct, Remark = remark, CreatedBy = "test", CreatedAt = now, UpdatedAt = now
        });
        await db.SaveChangesAsync();
    }

    // 读回一个订单（含 Lines→PartQtys）供断言。
    private async Task<Order> LoadOrderAsync(string externalOrderNo)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Orders.Include(o => o.PartQtys)
            .FirstAsync(o => o.ExternalOrderNo == externalOrderNo);
    }

    // ─── import-confirm 正常单 ───
    [Fact]
    public async Task ImportConfirm_NormalOrder_CreatesLinesAndPartQtys()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await SeedProductAsync("TEST01",
            ("兔子", new[] { "头", "身" }),
            ("青蛙", new[] { "头", "腿" }));

        var req = new
        {
            head = new { externalOrderNo = "ORD-N1", orderDate = "2026-06-10", deliveryDate = "2026-06-20", productNo = "TEST01", isMa = false },
            pdfToken = "tok-abc.pdf",
            asPendingProduct = false,
            lines = new[]
            {
                new { matchedItemName = "头", totalQty = 300 },
                new { matchedItemName = "腿", totalQty = 150 },
            }
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);

        var o = await LoadOrderAsync("ORD-N1");
        Assert.Equal(pid, o.ProductId);
        Assert.False(o.PendingProduct);
        Assert.Equal("draft", o.Status);
        Assert.Equal(2, o.PartQtys.Count);

        var head = o.PartQtys.Single(q => q.PartName == "头");
        Assert.Equal(300, head.Qty);
        Assert.NotNull(head.SourcePartId);

        var leg = o.PartQtys.Single(q => q.PartName == "腿");
        Assert.Equal(150, leg.Qty);

        // 正常单不应把 PDF token 存进 Remark
        Assert.Null(o.Remark);
    }

    // ─── import-confirm 待补产品 ───
    [Fact]
    public async Task ImportConfirm_PendingProduct_NoLinesTokenInRemark()
    {
        await LoginAsync("clerk", "clerk123");
        var req = new
        {
            head = new { externalOrderNo = "ORD-PEND", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = "99999", isMa = true },
            pdfToken = "tok-pend.pdf",
            asPendingProduct = true,
            lines = Array.Empty<object>()
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);

        var o = await LoadOrderAsync("ORD-PEND");
        Assert.Null(o.ProductId);
        Assert.True(o.PendingProduct);
        Assert.Empty(o.PartQtys);
        Assert.Contains("tok-pend.pdf", o.Remark);
        Assert.True(o.IsMA);
    }

    // ─── import-confirm 撞号 ───
    [Fact]
    public async Task ImportConfirm_DuplicateOrderNo_Returns409()
    {
        await LoginAsync("clerk", "clerk123");
        await SeedOrderAsync("ORD-DUP");
        var req = new
        {
            head = new { externalOrderNo = "ORD-DUP", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = "TEST01", isMa = false },
            pdfToken = "tok.pdf",
            asPendingProduct = true,
            lines = Array.Empty<object>()
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    // 种一个回收站（archived）产品，返回产品 id。
    private async Task<int> SeedArchivedProductAsync(string productNo, params string[] partNames)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        var p = new Product
        {
            ProductNo = productNo, IterationNo = "V1", Status = "archived",
            CreatedBy = "test", CreatedAt = now, UpdatedAt = now,
            Parts = partNames.Select((pn, pi) => new ProductPart { PartName = pn, PartOrder = pi }).ToList()
        };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return p.Id;
    }

    // ─── import-confirm 货号在回收站 + 勾选保存核价 → 复活为草稿并替换部位（不再 500）───
    [Fact]
    public async Task ImportConfirm_ArchivedProductWithSavePricing_RevivesAsDraft()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await SeedArchivedProductAsync("77711", "旧部位X", "旧部位Y");

        var req = new
        {
            head = new { externalOrderNo = "ORD-ARCH1", orderDate = "2026-08-26", deliveryDate = (string?)null, productNo = "77711", isMa = false },
            pdfToken = "tok-arch.pdf",
            asPendingProduct = false,
            savePricing = true,
            lines = new[]
            {
                new { matchedItemName = "P69雪糕猕猴桃", totalQty = 100, unitPrice = 0.14 },
                new { matchedItemName = "P03培根", totalQty = 200, unitPrice = 0.03 },
            }
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);

        var o = await LoadOrderAsync("ORD-ARCH1");
        Assert.Equal(pid, o.ProductId);
        Assert.Equal(2, o.PartQtys.Count);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var product = await db.Products.Include(p => p.Parts).FirstAsync(p => p.Id == pid);
        Assert.Equal("draft", product.Status);
        // 旧部位被替换为本次导入的部位与单价
        Assert.DoesNotContain(product.Parts, p => p.PartName == "旧部位X");
        Assert.Equal(2, product.Parts.Count);
        Assert.Equal(0.14, product.Parts.Single(p => p.PartName == "P69雪糕猕猴桃").UnitCost);
    }

    // ─── import-confirm 货号在回收站 + 未勾选保存核价 → 409 明确报错（不再 500）───
    [Fact]
    public async Task ImportConfirm_ArchivedProductWithoutSavePricing_Returns409()
    {
        await LoginAsync("clerk", "clerk123");
        await SeedArchivedProductAsync("77843", "部位A");
        var req = new
        {
            head = new { externalOrderNo = "ORD-ARCH2", orderDate = "2026-08-26", deliveryDate = (string?)null, productNo = "77843", isMa = false },
            pdfToken = "tok.pdf",
            asPendingProduct = false,
            savePricing = false,
            lines = new[] { new { matchedItemName = "部位A", totalQty = 10, unitPrice = 1.0 } }
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        Assert.Contains("回收站", body);
    }

    // ─── import-confirm 货号带首尾空格 → 归一后命中已有产品，不重复插入 ───
    [Fact]
    public async Task ImportConfirm_ProductNoWithWhitespace_MatchesExisting()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await SeedProductAsync("TESTWS", ("兔子", new[] { "头" }));
        var req = new
        {
            head = new { externalOrderNo = "ORD-WS", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = " TESTWS ", isMa = false },
            pdfToken = "tok.pdf",
            asPendingProduct = false,
            savePricing = false,
            lines = new[] { new { matchedItemName = "头", totalQty = 50, unitPrice = 1.0 } }
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var o = await LoadOrderAsync("ORD-WS");
        Assert.Equal(pid, o.ProductId);
    }

    [Fact]
    public async Task ImportConfirm_AsViewer_Forbidden()
    {
        await LoginAsync("viewer", "viewer123");
        var req = new
        {
            head = new { externalOrderNo = "ORD-V", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = "X", isMa = false },
            pdfToken = "t.pdf", asPendingProduct = true, lines = Array.Empty<object>()
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    // ─── continue-parse 校验 ───
    [Fact]
    public async Task ContinueParse_NotPendingProduct_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        await SeedOrderAsync("ORD-NP", pendingProduct: false);
        var o = await LoadOrderAsync("ORD-NP");
        var r = await _client.PostAsJsonAsync($"/api/orders/{o.Id}/continue-parse", new { productId = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task ContinueParse_OrderNotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/orders/999999/continue-parse", new { productId = 1 });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task ContinueParse_PdfLost_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        // 待补产品订单，但 token 指向不存在的 PDF → 400 原PDF已丢失
        await SeedOrderAsync("ORD-LOST", pendingProduct: true, remark: "PDF导入:does-not-exist.pdf");
        var o = await LoadOrderAsync("ORD-LOST");
        var pid = await SeedProductAsync("PNEW", ("兔子", new[] { "头" }));
        var r = await _client.PostAsJsonAsync($"/api/orders/{o.Id}/continue-parse", new { productId = pid });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ─── import-pdf 基本校验（空文件）───
    [Fact]
    public async Task ImportPdf_NoFile_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        using var content = new MultipartFormDataContent();
        var r = await _client.PostAsync("/api/orders/import-pdf", content);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ─── import-pdf 非 PDF 文件校验（M2）───
    [Fact]
    public async Task ImportPdf_NonPdfFile_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        // 上传一个 .txt 内容 + text/plain contentType，不是 PDF → 应 400。
        using var content = new MultipartFormDataContent();
        var fileBytes = System.Text.Encoding.UTF8.GetBytes("this is not a pdf");
        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/plain");
        content.Add(fileContent, "file", "test.txt");
        var r = await _client.PostAsync("/api/orders/import-pdf", content);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ─── import-confirm 正常单含 null/空子件名 → 400（防御 NPE）───
    [Fact]
    public async Task ImportConfirm_LineWithNullMatchedItem_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        // 先种一个产品，保证货号有效（校验在款号查询之前，故货号实际可随意，但保持真实流程一致）
        await SeedProductAsync("TEST-NULL",
            ("子件A", new[] { "部位1" }));

        // 正常单请求，但其中一条 MatchedItemName 为 null（模拟前端误传 JSON null 绕过非可空注解）
        var req = new
        {
            head = new { externalOrderNo = "ORD-NULL-ITEM", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = "TEST-NULL", isMa = false },
            pdfToken = "tok-null.pdf",
            asPendingProduct = false,
            lines = new object[]
            {
                new { matchedItemName = "子件A", totalQty = 100 },
                new { matchedItemName = (string?)null, totalQty = 50 },  // 未匹配行（null）
            }
        };
        var r = await _client.PostAsJsonAsync("/api/orders/import-confirm", req);
        // 应返回 400，而不是因 .Trim() NPE 导致 500
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        // 同样，空白字符串也应拒绝
        var req2 = new
        {
            head = new { externalOrderNo = "ORD-EMPTY-ITEM", orderDate = "2026-06-10", deliveryDate = (string?)null, productNo = "TEST-NULL", isMa = false },
            pdfToken = "tok-empty.pdf",
            asPendingProduct = false,
            lines = new object[]
            {
                new { matchedItemName = "子件A", totalQty = 100 },
                new { matchedItemName = "   ", totalQty = 50 },  // 纯空白
            }
        };
        var r2 = await _client.PostAsJsonAsync("/api/orders/import-confirm", req2);
        Assert.Equal(HttpStatusCode.BadRequest, r2.StatusCode);
    }
}
