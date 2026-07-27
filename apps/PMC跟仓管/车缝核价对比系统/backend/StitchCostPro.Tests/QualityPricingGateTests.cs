using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.QualityInspections;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class QualityPricingGateTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 待核价订单不能录入验货入库()
    {
        await using var db = NewDb();
        var supplier = new Supplier { SupplierCode = "S1", SupplierName = "一厂", DeptId = 1 };
        var product = new Product { ProductCode = "P1", ProductName = "款一", DeptId = 1 };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        var order = new PurchaseOrder
        {
            OrderNo = "PO-WAIT", SupplierId = supplier.SupplierId, OrderDate = new DateOnly(2026, 7, 18),
            Status = "待核价", DeptId = 1,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        var line = new PurchaseOrderLine
        {
            OrderId = order.OrderId, ProductId = product.ProductId,
            Qty = 100, Unit = "件", InternalPriceExcl = 10m,
        };
        db.PurchaseOrderLines.Add(line);
        await db.SaveChangesAsync();

        var service = new QualityInspectionService(db, new FakeUser());
        var (id, error) = await service.CreateAsync(new QualityUpsert(
            order.OrderId, line.LineId, new DateOnly(2026, 7, 18), null,
            null, null, 10, 10, 10, null, null, null, null, []));

        Assert.Equal(0, id);
        Assert.Contains("尚未完成外发核价", error);
        Assert.Empty(await db.QualityInspections.ToListAsync());
    }

    private sealed class FakeUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "tester";
        public string? Userbqrpower => null;
        public string? Role => "跟单";
    }
}
