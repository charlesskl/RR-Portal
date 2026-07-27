using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.Products;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class ProductLifecycleTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 作废货号会停用全部款_恢复后重新启用()
    {
        await using var db = NewDb();
        db.Products.AddRange(
            new Product { ProductCode = "A", SeriesCode = "A", StyleNo = "#1", ProductName = "款1", DeptId = 1, IsActive = true },
            new Product { ProductCode = "A#2", SeriesCode = "A", StyleNo = "#2", ProductName = "款2", DeptId = 1, IsActive = true });
        await db.SaveChangesAsync();
        var svc = new ProductService(db, new FakeCurrentUser());

        var (archived, archiveError) = await svc.SetSeriesActiveAsync("A", false);
        Assert.Null(archiveError);
        Assert.Equal(2, archived);
        Assert.All(await db.Products.ToListAsync(), p => Assert.False(p.IsActive));

        var (restored, restoreError) = await svc.SetSeriesActiveAsync("A", true);
        Assert.Null(restoreError);
        Assert.Equal(2, restored);
        Assert.All(await db.Products.ToListAsync(), p => Assert.True(p.IsActive));
    }

    [Fact]
    public async Task 正常列表与回收站互不混入()
    {
        await using var db = NewDb();
        db.Products.AddRange(
            new Product { ProductCode = "LIVE", SeriesCode = "LIVE", ProductName = "在用", DeptId = 1, IsActive = true },
            new Product { ProductCode = "OLD", SeriesCode = "OLD", ProductName = "作废", DeptId = 1, IsActive = false });
        await db.SaveChangesAsync();
        var svc = new ProductService(db, new FakeCurrentUser());

        var active = await svc.SeriesSummaryAsync(null, 1, false, 1, 20);
        var archived = await svc.SeriesSummaryAsync(null, 1, true, 1, 20);

        Assert.Equal("LIVE", Assert.Single(active.Items).Code);
        Assert.Equal("OLD", Assert.Single(archived.Items).Code);
    }

    [Fact]
    public async Task 无历史业务时永久删除货号及核价和别名()
    {
        await using var db = NewDb();
        var product = new Product { ProductCode = "A", SeriesCode = "A", ProductName = "款1", DeptId = 1, IsActive = true };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote { ProductId = product.ProductId, DeptId = 1, InternalPriceExcl = 10 });
        db.ProductImportAliases.Add(new ProductImportAlias { ProductId = product.ProductId, ProductCode = "A", ExternalName = "旧名称" });
        await db.SaveChangesAsync();
        var svc = new ProductService(db, new FakeCurrentUser());

        var (result, error) = await svc.DeleteSeriesAsync("A");

        Assert.Null(error);
        Assert.NotNull(result);
        Assert.Equal(1, result.ProductCount);
        Assert.Empty(await db.Products.ToListAsync());
        Assert.Empty(await db.ProductQuotes.ToListAsync());
        Assert.Empty(await db.ProductImportAliases.ToListAsync());
    }

    [Fact]
    public async Task 有历史业务时拦截删除并提示各类关联数量()
    {
        await using var db = NewDb();
        var product = new Product { ProductCode = "A", SeriesCode = "A", ProductName = "款1", DeptId = 1, IsActive = true };
        var supplier = new Supplier { SupplierCode = "S1", SupplierName = "加工厂", DeptId = 1, IsActive = true };
        db.Products.Add(product);
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();
        var order = new PurchaseOrder { OrderNo = "PO1", SupplierId = supplier.SupplierId, OrderDate = new DateOnly(2026, 7, 1), Status = "已下单" };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        var line = new PurchaseOrderLine { OrderId = order.OrderId, ProductId = product.ProductId, Qty = 100 };
        db.PurchaseOrderLines.Add(line);
        await db.SaveChangesAsync();
        db.QualityInspections.Add(new QualityInspection
        {
            OrderId = order.OrderId,
            LineId = line.LineId,
            ProductId = product.ProductId,
            SupplierId = supplier.SupplierId,
            ReceivedDate = new DateOnly(2026, 7, 2),
        });
        var note = new DeliveryNote
        {
            OrderId = order.OrderId,
            NoteNo = "DN1",
            ReceivedDate = new DateOnly(2026, 7, 2),
        };
        db.DeliveryNotes.Add(note);
        await db.SaveChangesAsync();
        db.DeliveryInspections.Add(new DeliveryInspection
        {
            DeliveryNoteId = note.DeliveryNoteId,
            LineId = line.LineId,
        });
        await db.SaveChangesAsync();
        var svc = new ProductService(db, new FakeCurrentUser());

        var (result, error) = await svc.DeleteSeriesAsync("A");

        Assert.Null(result);
        Assert.Contains("1 张外发订单", error);
        Assert.Contains("1 条质检记录", error);
        Assert.Contains("1 个回货批次", error);
        Assert.Single(await db.Products.ToListAsync());
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "admin";
        public string? Userbqrpower => null;
        public string? Role => "管理员";
    }
}
