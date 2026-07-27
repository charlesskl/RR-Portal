using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.OrderPricing;

public record OrderPricingLineDto(
    int LineId, int ProductId, string ProductLabel,
    decimal? Qty, string? Unit, decimal InternalPriceExcl, decimal? OutsourcePriceExcl,
    bool IsOver, int ChangeCount, string? LastChangeReason, DateTime? LastChangedAt);

public record OrderPricingDto(
    int OrderId, string OrderNo, int SupplierId, string SupplierName, DateOnly OrderDate,
    string Status, bool IsPricingComplete, bool HasStockIn, List<OrderPricingLineDto> Lines);

public record OrderPriceUpdateReq(decimal OutsourcePriceExcl, string? ChangeReason);
public record OrderPriceHistoryDto(
    int HistoryId, decimal? OldPriceExcl, decimal NewPriceExcl,
    string? ChangeReason, int? ChangedBy, string? ChangedByName, DateTime ChangedAt);

public class OrderPricingService(AppDbContext db, ICurrentUser current)
{
    public async Task<List<OrderPriceHistoryDto>> HistoryAsync(int lineId)
    {
        return await (
            from h in db.OrderPriceHistories.AsNoTracking()
            join u in db.SysUsers.AsNoTracking() on h.ChangedBy equals u.UserId into users
            from u in users.DefaultIfEmpty()
            where h.LineId == lineId
            orderby h.ChangedAt descending, h.HistoryId descending
            select new OrderPriceHistoryDto(
                h.HistoryId, h.OldPriceExcl, h.NewPriceExcl, h.ChangeReason,
                h.ChangedBy, u == null ? null : u.DisplayName, h.ChangedAt)
        ).ToListAsync();
    }

    public async Task<List<OrderPricingDto>> ListAsync(string? keyword)
    {
        var q = db.PurchaseOrders.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var k = keyword.Trim();
            q = q.Where(o => o.OrderNo.Contains(k) ||
                db.Suppliers.Any(s => s.SupplierId == o.SupplierId && s.SupplierName.Contains(k)));
        }
        var orders = await q.OrderBy(o => o.Status == "待核价" ? 0 : 1)
            .ThenByDescending(o => o.OrderId).ToListAsync();
        if (orders.Count == 0) return [];

        var orderIds = orders.Select(o => o.OrderId).ToList();
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => orderIds.Contains(l.OrderId)).ToListAsync();
        var lineIds = lines.Select(l => l.LineId).ToList();
        var histories = await db.OrderPriceHistories.AsNoTracking().Where(h => lineIds.Contains(h.LineId)).ToListAsync();
        var suppliers = await db.Suppliers.AsNoTracking().Where(s => orders.Select(o => o.SupplierId).Contains(s.SupplierId))
            .ToDictionaryAsync(s => s.SupplierId, s => s.SupplierName);
        var products = await db.Products.AsNoTracking().Where(p => lines.Select(l => l.ProductId).Contains(p.ProductId))
            .Select(p => new { p.ProductId, p.SeriesCode, p.ProductCode, p.StyleNo, p.ProductName }).ToListAsync();
        var stockedOrderIds = await db.QualityInspections.AsNoTracking()
            .Where(x => orderIds.Contains(x.OrderId) && (x.StockInQty ?? 0) > 0)
            .Select(x => x.OrderId).Distinct().ToListAsync();

        string ProductLabel(int id)
        {
            var p = products.FirstOrDefault(x => x.ProductId == id);
            return p is null ? $"#{id}" : $"{p.SeriesCode ?? p.ProductCode} {p.StyleNo ?? ""} {p.ProductName}".Trim();
        }

        return orders.Select(o =>
        {
            var orderLines = lines.Where(l => l.OrderId == o.OrderId).OrderBy(l => l.LineId).Select(l =>
            {
                var hs = histories.Where(h => h.LineId == l.LineId).OrderByDescending(h => h.ChangedAt).ToList();
                var last = hs.FirstOrDefault();
                var internalPrice = l.InternalPriceExcl ?? 0;
                return new OrderPricingLineDto(
                    l.LineId, l.ProductId, ProductLabel(l.ProductId), l.Qty, l.Unit,
                    internalPrice, l.OutsourcePriceExcl,
                    l.OutsourcePriceExcl is not null && l.OutsourcePriceExcl > internalPrice,
                    hs.Count, last?.ChangeReason, last?.ChangedAt);
            }).ToList();
            return new OrderPricingDto(o.OrderId, o.OrderNo, o.SupplierId,
                suppliers.GetValueOrDefault(o.SupplierId, ""), o.OrderDate, o.Status,
                orderLines.Count > 0 && orderLines.All(l => l.OutsourcePriceExcl is not null),
                stockedOrderIds.Contains(o.OrderId), orderLines);
        }).ToList();
    }

    public async Task<(bool ok, string? error)> UpdateLineAsync(int lineId, OrderPriceUpdateReq req)
    {
        if (current.Role is not ("外发" or "管理员")) return (false, "无权维护外发价格");
        if (req.OutsourcePriceExcl < 0) return (false, "外发价格不能小于 0");

        var line = await db.PurchaseOrderLines.FirstOrDefaultAsync(l => l.LineId == lineId);
        if (line is null) return (false, "订单明细不存在");
        var order = await db.PurchaseOrders.FirstOrDefaultAsync(o => o.OrderId == line.OrderId);
        if (order is null) return (false, "订单不存在");

        var changed = line.OutsourcePriceExcl != req.OutsourcePriceExcl;
        if (!changed) return (true, null);
        var hasStockIn = await db.QualityInspections.AsNoTracking()
            .AnyAsync(x => x.OrderId == order.OrderId && (x.StockInQty ?? 0) > 0)
            || await db.DeliveryNotes.AsNoTracking().AnyAsync(x => x.OrderId == order.OrderId);
        if (hasStockIn && current.Role != "管理员")
            return (false, "订单已有回货、验货或入库记录，只有管理员可以改价");

        var reason = string.IsNullOrWhiteSpace(req.ChangeReason) ? null : req.ChangeReason.Trim();
        var isChange = line.OutsourcePriceExcl is not null;
        var isOver = line.InternalPriceExcl is not null && req.OutsourcePriceExcl > line.InternalPriceExcl.Value;
        if ((isChange || isOver || hasStockIn) && reason is null)
            return (false, isOver ? "外发价高于本厂核价，请填写超价原因" : "请填写改价原因");

        var old = line.OutsourcePriceExcl;
        line.OutsourcePriceExcl = req.OutsourcePriceExcl;
        db.OrderPriceHistories.Add(new OrderPriceHistory
        {
            LineId = line.LineId,
            OldPriceExcl = old,
            NewPriceExcl = req.OutsourcePriceExcl,
            ChangeReason = reason ?? "首次核价",
            ChangedBy = current.UserId,
            ChangedAt = DateTime.UtcNow,
        });

        await db.SaveChangesAsync();
        var allPriced = await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => l.OrderId == order.OrderId).AllAsync(l => l.OutsourcePriceExcl != null);
        if (allPriced && order.Status == "待核价")
        {
            order.Status = order.ProductionProgress <= 0 ? "已下单"
                : order.ProductionProgress >= 100 ? "已交货" : "生产中";
            order.UpdatedBy = current.UserId;
            order.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        return (true, null);
    }
}
