using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.SupplierEvaluation;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class EvaluationSettingsTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 保存评价参数后可按部门读取()
    {
        await using var db = NewDb();
        var svc = new SupplierEvaluationService(db);
        var expected = new EvaluationSettings(0.15m, 0.5m, 0.3m, 0.2m, 92m, 82m, 72m);

        var error = await svc.SaveSettingsAsync(1, expected, 7);
        var actual = await svc.GetSettingsAsync(1);

        Assert.Null(error);
        Assert.Equal(expected, actual);
        Assert.Equal(7, await db.RateConfigs.CountAsync(x => x.IsCurrent));
    }

    [Fact]
    public async Task 权重之和不是百分百时拒绝保存()
    {
        await using var db = NewDb();
        var svc = new SupplierEvaluationService(db);

        var error = await svc.SaveSettingsAsync(1, new EvaluationSettings(0.12m, 0.5m, 0.5m, 0.2m, 90m, 80m, 70m), 1);

        Assert.NotNull(error);
        Assert.Empty(db.RateConfigs);
    }

    [Fact]
    public async Task 默认返回全部启用加工厂且无业务的显示未评级()
    {
        await using var db = NewDb();
        db.Suppliers.AddRange(
            new Supplier { SupplierId = 1, SupplierCode = "S1", SupplierName = "有业务厂", DeptId = 1, IsActive = true, CreatedAt = DateTime.UtcNow.AddMonths(-2) },
            new Supplier { SupplierId = 2, SupplierCode = "S2", SupplierName = "本月新厂", DeptId = 1, IsActive = true, CreatedAt = DateTime.UtcNow },
            new Supplier { SupplierId = 3, SupplierCode = "S3", SupplierName = "停用厂", DeptId = 1, IsActive = false, CreatedAt = DateTime.UtcNow });
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            OrderId = 10, OrderNo = "PO10", SupplierId = 1, OrderDate = new DateOnly(2025, 1, 1),
            Status = "已交货", DeptId = 1, CreatedAt = DateTime.UtcNow.AddYears(-1),
        });
        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = 10, ProductId = 1, Qty = 100,
            InternalPriceExcl = 10, OutsourcePriceExcl = 9,
        });
        await db.SaveChangesAsync();

        var rows = await new SupplierEvaluationService(db).EvaluateAsync();

        Assert.Equal(2, rows.Count);
        Assert.NotNull(rows.Single(x => x.SupplierId == 1).TotalScore);
        var unrated = rows.Single(x => x.SupplierId == 2);
        Assert.Equal("未评级", unrated.Grade);
        Assert.Null(unrated.TotalScore);
        Assert.True(unrated.IsNewThisMonth);
        Assert.DoesNotContain(rows, x => x.SupplierId == 3);
    }

    [Fact]
    public async Task 缺少质量和交付数据时标记观察中且同价记为价格异常()
    {
        await using var db = NewDb();
        db.Suppliers.Add(new Supplier
        {
            SupplierId = 1, SupplierCode = "S1", SupplierName = "样本不足厂",
            DeptId = 1, IsActive = true, CreatedAt = DateTime.UtcNow.AddMonths(-1),
        });
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            OrderId = 10, OrderNo = "PO10", SupplierId = 1, OrderDate = new DateOnly(2025, 1, 1),
            Status = "生产中", DeptId = 1, CreatedAt = DateTime.UtcNow,
        });
        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = 10, ProductId = 1, Qty = 100,
            InternalPriceExcl = 10, OutsourcePriceExcl = 10,
        });
        await db.SaveChangesAsync();

        var row = Assert.Single(await new SupplierEvaluationService(db).EvaluateAsync());

        Assert.Null(row.QualityScore);
        Assert.Equal(0m, row.PriceScore);
        Assert.Null(row.DeliveryScore);
        Assert.Equal(0m, row.TotalScore);
        Assert.Equal("观察中", row.Grade);
        Assert.Equal(1, row.DataCoverage);
        Assert.Equal(1, row.OverPriceCount);
    }

    [Fact]
    public async Task 按确认规则计算价格质量交付和综合等级()
    {
        await using var db = NewDb();
        db.Suppliers.Add(new Supplier
        {
            SupplierId = 1, SupplierCode = "S1", SupplierName = "优先厂",
            DeptId = 1, IsActive = true, CreatedAt = DateTime.UtcNow.AddMonths(-1),
        });
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            OrderId = 10, OrderNo = "PO10", SupplierId = 1, OrderDate = new DateOnly(2025, 1, 1),
            Status = "已交货", DelayDays = 2, DeptId = 1, CreatedAt = DateTime.UtcNow,
        });
        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = 10, ProductId = 1, Qty = 100,
            InternalPriceExcl = 10, OutsourcePriceExcl = 9,
        });
        db.QualityInspections.AddRange(
            new QualityInspection
            {
                InspectionId = 1, OrderId = 10, ProductId = 1, SupplierId = 1,
                ReceivedDate = new DateOnly(2025, 1, 10), QcQty = 20,
            },
            new QualityInspection
            {
                InspectionId = 2, OrderId = 10, ProductId = 1, SupplierId = 1,
                ReceivedDate = new DateOnly(2025, 1, 11), QcQty = 80,
            });
        db.QualityDefects.AddRange(
            new QualityDefect { InspectionId = 1, DefectType = "压毛", Qty = 5 },
            new QualityDefect { InspectionId = 1, DefectType = "露线", Qty = 3 },
            new QualityDefect { InspectionId = 1, DefectType = "耳朵", Qty = 4 },
            new QualityDefect { InspectionId = 1, DefectType = "眼睛", Qty = 5 },
            new QualityDefect { InspectionId = 2, DefectType = "线头", Qty = 18 },
            new QualityDefect { InspectionId = 2, DefectType = "污染", Qty = 10 },
            new QualityDefect { InspectionId = 2, DefectType = "车缝", Qty = 12 },
            new QualityDefect { InspectionId = 2, DefectType = "露线", Qty = 8 });
        await db.SaveChangesAsync();

        var row = Assert.Single(await new SupplierEvaluationService(db).EvaluateAsync());

        Assert.Equal(83.8m, row.QualityScore);
        Assert.Equal(100m, row.PriceScore);
        Assert.Equal(100m, row.DeliveryScore);
        Assert.Equal(93.5m, row.TotalScore);
        Assert.Equal("A 优先", row.Grade);
        Assert.Equal("优先分单", row.Advice);
        Assert.Equal(0, row.OverPriceCount);

        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = 10, ProductId = 2, Qty = 1,
            InternalPriceExcl = 10, OutsourcePriceExcl = 10,
        });
        await db.SaveChangesAsync();

        var capped = Assert.Single(await new SupplierEvaluationService(db).EvaluateAsync());
        Assert.Equal("C 观察", capped.Grade);
        Assert.Equal("存在1款价格异常", capped.Advice);
        Assert.Equal(1, capped.OverPriceCount);
    }

    [Fact]
    public async Task 延期十天为五十分且单项低于底线时评为观察()
    {
        await using var db = NewDb();
        db.Suppliers.Add(new Supplier
        {
            SupplierId = 1, SupplierCode = "S1", SupplierName = "交付短板厂",
            DeptId = 1, IsActive = true, CreatedAt = DateTime.UtcNow.AddMonths(-1),
        });
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            OrderId = 10, OrderNo = "PO10", SupplierId = 1, OrderDate = new DateOnly(2025, 1, 1),
            Status = "已交货", DelayDays = 10, DeptId = 1, CreatedAt = DateTime.UtcNow,
        });
        db.PurchaseOrderLines.Add(new PurchaseOrderLine
        {
            OrderId = 10, ProductId = 1, Qty = 100,
            InternalPriceExcl = 10, OutsourcePriceExcl = 9.5m,
        });
        db.QualityInspections.Add(new QualityInspection
        {
            InspectionId = 1, OrderId = 10, ProductId = 1, SupplierId = 1,
            ReceivedDate = new DateOnly(2025, 1, 10), QcQty = 100,
        });
        await db.SaveChangesAsync();

        var row = Assert.Single(await new SupplierEvaluationService(db).EvaluateAsync());

        Assert.Equal(100m, row.QualityScore);
        Assert.Equal(80m, row.PriceScore);
        Assert.Equal(50m, row.DeliveryScore);
        Assert.Equal(82m, row.TotalScore);
        Assert.Equal("C 观察", row.Grade);
        Assert.Equal("存在短板，谨慎分单", row.Advice);
    }
}
