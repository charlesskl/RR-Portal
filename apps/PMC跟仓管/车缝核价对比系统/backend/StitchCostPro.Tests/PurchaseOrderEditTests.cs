using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.PurchaseOrders;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class PurchaseOrderEditTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 只改数量时保留订单号和价格快照()
    {
        await using var db = NewDb();
        var (order, line) = await SeedOrderAsync(db);
        var svc = new PurchaseOrderService(db, new FakeCurrentUser());

        var (ok, error) = await svc.UpdateAsync(order.OrderId,
            new OrderEditReq(order.SupplierId, new DateOnly(2026, 7, 2), null, "等物料", "跟进中",
                [new OrderEditLineReq(line.LineId, line.ProductId, 200, null)]));

        Assert.True(ok, error);
        var savedOrder = await db.PurchaseOrders.SingleAsync();
        var savedLine = await db.PurchaseOrderLines.SingleAsync();
        Assert.Equal("PO-LOCKED", savedOrder.OrderNo);
        Assert.Equal(12.5m, savedLine.OutsourcePriceExcl);
        Assert.Equal(8.5m, savedLine.InternalPriceExcl);
        Assert.Equal(200, savedLine.Qty);
    }

    [Fact]
    public async Task 换厂或换款时清空外发价并回到待核价()
    {
        await using var db = NewDb();
        var (order, line) = await SeedOrderAsync(db);
        var supplier2 = new Supplier { SupplierCode = "S2", SupplierName = "二厂", DeptId = 1 };
        var product2 = new Product { ProductCode = "P2", ProductName = "新款", DeptId = 1 };
        db.AddRange(supplier2, product2);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote { ProductId = product2.ProductId, InternalPriceExcl = 5, DeptId = 1 });
        await db.SaveChangesAsync();

        var svc = new PurchaseOrderService(db, new FakeCurrentUser());
        var (ok, error) = await svc.UpdateAsync(order.OrderId,
            new OrderEditReq(supplier2.SupplierId, order.OrderDate, order.DeliveryDate, null, null,
                [new OrderEditLineReq(line.LineId, product2.ProductId, 50, null)]));

        Assert.True(ok, error);
        var saved = await db.PurchaseOrderLines.SingleAsync();
        Assert.Null(saved.OutsourcePriceExcl);
        Assert.Equal(5m, saved.InternalPriceExcl);
        var savedOrder = await db.PurchaseOrders.SingleAsync();
        Assert.Equal(supplier2.SupplierId, savedOrder.SupplierId);
        Assert.Equal("待核价", savedOrder.Status);
    }

    [Fact]
    public async Task 已有回货时锁定加工厂和明细但允许改日期原因备注()
    {
        await using var db = NewDb();
        var (order, line) = await SeedOrderAsync(db);
        db.DeliveryNotes.Add(new DeliveryNote { OrderId = order.OrderId, NoteNo = "DN1", ReceivedDate = new DateOnly(2026, 7, 4) });
        await db.SaveChangesAsync();
        var svc = new PurchaseOrderService(db, new FakeCurrentUser());

        var (blocked, blockedError) = await svc.UpdateAsync(order.OrderId,
            new OrderEditReq(order.SupplierId, order.OrderDate, order.DeliveryDate, null, null,
                [new OrderEditLineReq(line.LineId, line.ProductId, 999, null)]));
        Assert.False(blocked);
        Assert.Contains("不能修改产品", blockedError);

        var newDelivery = new DateOnly(2026, 7, 20);
        var (ok, error) = await svc.UpdateAsync(order.OrderId,
            new OrderEditReq(order.SupplierId, order.OrderDate, newDelivery, "产能不足", "继续跟进",
                [new OrderEditLineReq(line.LineId, line.ProductId, line.Qty, line.Unit)]));
        Assert.True(ok, error);
        var saved = await db.PurchaseOrders.SingleAsync();
        Assert.Equal(newDelivery, saved.DeliveryDate);
        Assert.Equal("产能不足", saved.DelayReason);
        Assert.Equal("继续跟进", saved.Remark);
    }

    private static async Task<(PurchaseOrder order, PurchaseOrderLine line)> SeedOrderAsync(AppDbContext db)
    {
        var supplier = new Supplier { SupplierCode = "S1", SupplierName = "一厂", DeptId = 1 };
        var product = new Product { ProductCode = "P1", ProductName = "旧款", DeptId = 1 };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        var order = new PurchaseOrder
        {
            OrderNo = "PO-LOCKED", SupplierId = supplier.SupplierId, OrderDate = new DateOnly(2026, 7, 1),
            Status = "已下单", DeptId = 1,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        var line = new PurchaseOrderLine
        {
            OrderId = order.OrderId, ProductId = product.ProductId,
            Qty = 100, OutsourcePriceExcl = 12.5m, InternalPriceExcl = 8.5m,
        };
        db.PurchaseOrderLines.Add(line);
        await db.SaveChangesAsync();
        return (order, line);
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "follower";
        public string? Userbqrpower => null;
        public string? Role => "跟单";
    }
}
