using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.PurchaseOrders;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class PurchaseOrderImportTests
{
    [Fact]
    public async Task 多订单导入会匹配产品并把含税价转换为不含税价()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var supplier = new Supplier { SupplierName = "高州市开源制衣厂", SupplierCode = "S1", DeptId = 1 };
        var product = new Product
        {
            ProductCode = "15752", SeriesCode = "15752", ProductName = "布偶猫", DeptId = 1, IsActive = true,
        };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote
        {
            ProductId = product.ProductId, DeptId = 1, InternalPriceExcl = 2.18m, CustomerQuoteExcl = 2.68m,
        });
        await db.SaveChangesAsync();
        var order = new OrderImportInput(
            "采购单.xlsx", "NBFY26070101", supplier.SupplierName, new DateOnly(2026, 7, 1),
            new DateOnly(2026, 8, 15), null,
            [new OrderImportLineInput(12, "15752", "布偶猫", 55000, "PCS", 2.26m, true)]);
        var service = new PurchaseOrderImportService(db, new FakeUser());

        var preview = await service.PreviewAsync([order]);
        var result = await service.CommitAsync([new OrderImportCommitOrder(order, true)]);

        Assert.Equal(1, preview.ReadyCount);
        Assert.Equal(2m, preview.Orders.Single().Lines.Single().OutsourcePriceExcl);
        Assert.Equal(1, result.Created);
        var savedLine = await db.PurchaseOrderLines.SingleAsync();
        Assert.Equal(2m, savedLine.OutsourcePriceExcl);
        Assert.Equal(2.18m, savedLine.InternalPriceExcl);
        Assert.Single(await db.OrderPriceHistories.ToListAsync());
    }

    [Fact]
    public async Task 订单加工厂全称可以匹配系统简称()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var supplier = new Supplier
        {
            SupplierName = "开源", SupplierCode = "开源", DeptId = 1, IsActive = true,
        };
        var product = new Product
        {
            ProductCode = "15752", SeriesCode = "15752", ProductName = "布偶猫",
            DeptId = 1, IsActive = true,
        };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote
        {
            ProductId = product.ProductId, DeptId = 1, InternalPriceExcl = 2.18m,
        });
        await db.SaveChangesAsync();
        var order = new OrderImportInput(
            "开源采购单.xlsx", "NBFM260511", "高州市开源制衣厂", new DateOnly(2026, 5, 11),
            new DateOnly(2026, 12, 31), null,
            [new OrderImportLineInput(10, "15752", "布偶猫", 1000, "PCS", 2.26m, true)]);

        var preview = await new PurchaseOrderImportService(db, new FakeUser()).PreviewAsync([order]);

        var checkedOrder = Assert.Single(preview.Orders);
        Assert.Equal("ok", checkedOrder.Status);
        Assert.Equal(supplier.SupplierId, checkedOrder.SupplierId);
    }

    [Fact]
    public async Task 款式去除尺寸前缀后可自动匹配并记住别名()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var supplier = new Supplier { SupplierName = "开源", SupplierCode = "开源", DeptId = 1, IsActive = true };
        var product = new Product
        {
            ProductCode = "157117", SeriesCode = "157117", ProductName = "3.5\"灰白豹纹怪",
            DeptId = 1, IsActive = true,
        };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote
        {
            ProductId = product.ProductId, DeptId = 1, InternalPriceExcl = 1.59m,
        });
        await db.SaveChangesAsync();
        var order = new OrderImportInput(
            "开源采购单.xlsx", "NBFM260515-09", "高州市开源制衣厂",
            new DateOnly(2026, 5, 15), new DateOnly(2026, 12, 31), null,
            [new OrderImportLineInput(202, "157117", "灰白豹纹怪", 15000, "PCS", 1.77m, true)]);
        var service = new PurchaseOrderImportService(db, new FakeUser());

        var preview = await service.PreviewAsync([order]);
        var line = Assert.Single(Assert.Single(preview.Orders).Lines);
        Assert.Equal("ok", line.Status);
        Assert.Equal("normalized", line.MatchType);
        Assert.Equal(product.ProductId, line.ProductId);

        await service.CommitAsync([new OrderImportCommitOrder(order, true)]);
        var alias = await db.ProductImportAliases.SingleAsync();
        Assert.Equal("灰白豹纹怪", alias.ExternalName);
        Assert.Equal(product.ProductId, alias.ProductId);
    }

    [Fact]
    public async Task 同一订单同款同价会自动合并数量()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var supplier = new Supplier { SupplierName = "开源", SupplierCode = "开源", DeptId = 1, IsActive = true };
        var product = new Product
        {
            ProductCode = "15752", SeriesCode = "15752", ProductName = "布偶猫",
            DeptId = 1, IsActive = true,
        };
        db.AddRange(supplier, product);
        await db.SaveChangesAsync();
        db.ProductQuotes.Add(new ProductQuote
        {
            ProductId = product.ProductId, DeptId = 1, InternalPriceExcl = 2.18m,
        });
        await db.SaveChangesAsync();
        var order = new OrderImportInput(
            "开源采购单.xlsx", "NBFM26070101", "高州市开源制衣厂",
            new DateOnly(2026, 7, 1), new DateOnly(2026, 8, 15), null,
            [
                new OrderImportLineInput(392, "15752", "布偶猫", 55000, "PCS", 2.24m, true),
                new OrderImportLineInput(393, "15752", "布偶猫", 15000, "PCS", 2.24m, true),
            ]);
        var service = new PurchaseOrderImportService(db, new FakeUser());

        var preview = await service.PreviewAsync([order]);

        var checkedOrder = Assert.Single(preview.Orders);
        Assert.Equal("ok", checkedOrder.Status);
        var line = Assert.Single(checkedOrder.Lines);
        Assert.Equal(70000m, line.Qty);
        Assert.Equal("merged", line.MatchType);

        var result = await service.CommitAsync([new OrderImportCommitOrder(order, true)]);
        Assert.Equal(1, result.Created);
        Assert.Equal(70000m, (await db.PurchaseOrderLines.SingleAsync()).Qty);
    }

    private sealed class FakeUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "admin";
        public string? Userbqrpower => null;
        public string? Role => "管理员";
    }
}
