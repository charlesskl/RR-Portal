using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.PriceBoard;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class ProductLevelPricingTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 按产品看是一订单一款式一行并正确计算占比和节约总价()
    {
        await using var db = NewDb();
        var supplier = new Supplier { SupplierCode = "S1", SupplierName = "东莞一厂", DeptId = 1 };
        var product = new Product { ProductCode = "15752-A", SeriesCode = "15752", ProductName = "布偶猫", DeptId = 1 };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        var order = new PurchaseOrder
        {
            OrderNo = "NBFW26070101", SupplierId = supplier.SupplierId,
            OrderDate = new DateOnly(2026, 7, 1), Status = "已下单", DeptId = 1,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = order.OrderId, ProductId = product.ProductId, Qty = 100,
            CustomerQuoteExcl = 2.68m, InternalPriceExcl = 2.18m, OutsourcePriceExcl = 2.00m,
        });
        await db.SaveChangesAsync();

        var result = await new PriceBoardService(db).GetAsync(new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 31));

        var row = Assert.Single(result.ByStyle);
        Assert.Equal("NBFW26070101", row.OrderNo);
        Assert.Equal(2.68m, row.CustomerQuote);
        Assert.Equal(91.74m, row.OutSelfRate);
        Assert.Equal(18m, row.SaveValue);
    }
}
