using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.OrderPricing;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class OrderPricingTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 首次核价写历史并把订单转为已下单()
    {
        await using var db = NewDb();
        var (order, line) = await SeedAsync(db);
        var svc = new OrderPricingService(db, new FakeUser("外发"));

        var (ok, error) = await svc.UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(8m, null));

        Assert.True(ok, error);
        Assert.Equal("已下单", (await db.PurchaseOrders.SingleAsync()).Status);
        var history = await db.OrderPriceHistories.SingleAsync();
        Assert.Null(history.OldPriceExcl);
        Assert.Equal(8m, history.NewPriceExcl);
        Assert.Equal("首次核价", history.ChangeReason);
    }

    [Fact]
    public async Task 超过本厂核价必须填写原因()
    {
        await using var db = NewDb();
        var (_, line) = await SeedAsync(db);
        var svc = new OrderPricingService(db, new FakeUser("外发"));

        var (ok, error) = await svc.UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(11m, null));

        Assert.False(ok);
        Assert.Contains("超价原因", error);
        Assert.Null((await db.PurchaseOrderLines.SingleAsync()).OutsourcePriceExcl);
    }

    [Fact]
    public async Task 入库后只有管理员可带原因改价()
    {
        await using var db = NewDb();
        var (order, line) = await SeedAsync(db, 8m);
        db.QualityInspections.Add(new QualityInspection
        {
            OrderId = order.OrderId, LineId = line.LineId, ProductId = line.ProductId, SupplierId = order.SupplierId,
            ReceivedDate = new DateOnly(2026, 7, 16), StockInQty = 10,
        });
        await db.SaveChangesAsync();

        var (blocked, _) = await new OrderPricingService(db, new FakeUser("外发"))
            .UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(7.5m, "价格调整"));
        Assert.False(blocked);

        var (ok, error) = await new OrderPricingService(db, new FakeUser("管理员"))
            .UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(7.5m, "老板确认"));
        Assert.True(ok, error);
        Assert.Equal(7.5m, (await db.PurchaseOrderLines.SingleAsync()).OutsourcePriceExcl);
    }

    [Fact]
    public async Task 可以按订单产品读取价格修改历史()
    {
        await using var db = NewDb();
        var (_, line) = await SeedAsync(db);
        var svc = new OrderPricingService(db, new FakeUser("外发"));
        await svc.UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(8m, null));
        await svc.UpdateLineAsync(line.LineId, new OrderPriceUpdateReq(7.5m, "协商降价"));

        var rows = await svc.HistoryAsync(line.LineId);

        Assert.Equal(2, rows.Count);
        Assert.Equal(8m, rows[0].OldPriceExcl);
        Assert.Equal(7.5m, rows[0].NewPriceExcl);
        Assert.Equal("协商降价", rows[0].ChangeReason);
    }

    private static async Task<(PurchaseOrder order, PurchaseOrderLine line)> SeedAsync(AppDbContext db, decimal? outPrice = null)
    {
        var supplier = new Supplier { SupplierCode = "S1", SupplierName = "一厂", DeptId = 1 };
        var product = new Product { ProductCode = "P1", ProductName = "款一", DeptId = 1 };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        var order = new PurchaseOrder
        {
            OrderNo = "PO-PRICE", SupplierId = supplier.SupplierId, OrderDate = new DateOnly(2026, 7, 16),
            Status = outPrice is null ? "待核价" : "已下单", DeptId = 1,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        var line = new PurchaseOrderLine
        {
            OrderId = order.OrderId, ProductId = product.ProductId,
            Qty = 100, Unit = "件", InternalPriceExcl = 10m, OutsourcePriceExcl = outPrice,
        };
        db.PurchaseOrderLines.Add(line);
        await db.SaveChangesAsync();
        return (order, line);
    }

    private sealed class FakeUser(string role) : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "tester";
        public string? Userbqrpower => null;
        public string? Role => role;
    }
}
