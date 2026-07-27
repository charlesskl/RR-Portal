using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.PurchaseOrders;

public record OrderLineUpsert(int ProductId, decimal? Qty, string? Unit);
public record OrderUpsert(string OrderNo, int SupplierId, DateOnly OrderDate, DateOnly? DeliveryDate, string? Remark, List<OrderLineUpsert> Lines);
public record OrderEditLineReq(int? LineId, int ProductId, decimal? Qty, string? Unit);
public record OrderEditReq(int SupplierId, DateOnly OrderDate, DateOnly? DeliveryDate, string? DelayReason, string? Remark, List<OrderEditLineReq> Lines);
public record OrderEditLineDto(int LineId, int ProductId, decimal? Qty, string? Unit);
public record OrderEditDto(int OrderId, string OrderNo, int SupplierId, DateOnly OrderDate, DateOnly? DeliveryDate,
    string Status, int ProductionProgress, string? DelayReason, string? Remark, bool HasLinkedRecords, List<OrderEditLineDto> Lines);

public record OrderLineDto(int LineId, int ProductId, string ProductLabel, decimal? Qty, string? Unit,
    decimal? CustomerQuoteExcl, decimal? InternalPriceExcl, decimal? DongguanPriceExcl, decimal? HunanPriceExcl,
    decimal? OutsourcePriceExcl, decimal? Saving, decimal? OutsourceInternalRate, string? Compliance);

public record OrderListRow(int OrderId, string OrderNo, int SupplierId, string SupplierName,
    string SeriesCodes, string StyleNames, decimal TotalQty,
    DateOnly OrderDate, DateOnly? DeliveryDate, int ProductionProgress, int DelayDays,
    string? DelayReason, string Status, string? Remark, int LineCount);

public record OrderDetailDto(int OrderId, string OrderNo, int SupplierId, string SupplierName, DateOnly OrderDate,
    DateOnly? DeliveryDate, string Status, string? Remark, decimal? OutsourceTotal, decimal? Saving, bool HasOver,
    bool IsPricingComplete, List<OrderLineDto> Lines, int ProductionProgress, int DelayDays, string? DelayReason);

/// <summary>采购订单：一行一个款式，创建或换款时保存产品价格快照。</summary>
public class PurchaseOrderService(AppDbContext db, ICurrentUser current)
{
    private static decimal? LineSaving(decimal? internalPrice, decimal? outsource, decimal? qty)
        => internalPrice is null || outsource is null ? null : (internalPrice.Value - outsource.Value) * (qty ?? 0);
    private static decimal? Rate(decimal? internalPrice, decimal? outsource)
        => internalPrice is null or 0 || outsource is null ? null : Math.Round(outsource.Value / internalPrice.Value * 100m, 2);
    private static string? Compliance(decimal? internalPrice, decimal? outsource)
        => internalPrice is null || outsource is null ? null : outsource <= internalPrice ? "合规" : "超标";

    public async Task<List<OrderListRow>> ListAsync(int? deptId, string? keyword)
    {
        var q = db.PurchaseOrders.AsNoTracking();
        if (deptId is not null) q = q.Where(o => o.DeptId == deptId);
        if (!string.IsNullOrWhiteSpace(keyword)) q = q.Where(o => o.OrderNo.Contains(keyword));
        var orders = await q.OrderByDescending(o => o.OrderId).ToListAsync();
        var orderIds = orders.Select(o => o.OrderId).ToList();
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => orderIds.Contains(l.OrderId)).ToListAsync();
        var suppliers = await db.Suppliers.AsNoTracking().Where(s => orders.Select(o => o.SupplierId).Contains(s.SupplierId))
            .ToDictionaryAsync(s => s.SupplierId, s => s.SupplierName);
        var products = (await db.Products.AsNoTracking().Where(p => lines.Select(l => l.ProductId).Contains(p.ProductId))
            .Select(p => new { p.ProductId, p.SeriesCode, p.ProductCode, p.ProductName }).ToListAsync()).ToDictionary(p => p.ProductId);
        static string Join(IEnumerable<string> xs) => string.Join(" / ", xs.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct());

        return orders.Select(o =>
        {
            var ls = lines.Where(l => l.OrderId == o.OrderId).ToList();
            return new OrderListRow(o.OrderId, o.OrderNo, o.SupplierId, suppliers.GetValueOrDefault(o.SupplierId, ""),
                Join(ls.Select(l => products.TryGetValue(l.ProductId, out var p) ? p.SeriesCode ?? p.ProductCode : "")),
                Join(ls.Select(l => products.TryGetValue(l.ProductId, out var p) ? p.ProductName : "")),
                ls.Sum(l => l.Qty ?? 0), o.OrderDate, o.DeliveryDate, o.ProductionProgress, o.DelayDays,
                o.DelayReason, o.Status, o.Remark, ls.Count);
        }).ToList();
    }

    public async Task<OrderEditDto?> GetEditAsync(int id)
    {
        var o = await db.PurchaseOrders.AsNoTracking().FirstOrDefaultAsync(x => x.OrderId == id);
        if (o is null) return null;
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => l.OrderId == id).OrderBy(l => l.LineId)
            .Select(l => new OrderEditLineDto(l.LineId, l.ProductId, l.Qty, l.Unit)).ToListAsync();
        return new OrderEditDto(o.OrderId, o.OrderNo, o.SupplierId, o.OrderDate, o.DeliveryDate, o.Status,
            o.ProductionProgress, o.DelayReason, o.Remark, await HasLinkedRecordsAsync(id), lines);
    }

    public async Task<OrderDetailDto?> GetAsync(int id)
    {
        var o = await db.PurchaseOrders.AsNoTracking().FirstOrDefaultAsync(x => x.OrderId == id);
        if (o is null) return null;
        var supplier = await db.Suppliers.AsNoTracking().Where(s => s.SupplierId == o.SupplierId)
            .Select(s => s.SupplierName).FirstOrDefaultAsync() ?? "";
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => l.OrderId == id).ToListAsync();
        var products = await db.Products.AsNoTracking().Where(p => lines.Select(l => l.ProductId).Contains(p.ProductId))
            .Select(p => new { p.ProductId, p.SeriesCode, p.ProductCode, p.StyleNo, p.ProductName }).ToListAsync();
        string Label(int id)
        {
            var p = products.FirstOrDefault(x => x.ProductId == id);
            return p is null ? $"#{id}" : $"{p.SeriesCode ?? p.ProductCode} {p.StyleNo ?? ""} {p.ProductName}".Trim();
        }
        var dtos = lines.Select(l => new OrderLineDto(l.LineId, l.ProductId, Label(l.ProductId), l.Qty, l.Unit,
            l.CustomerQuoteExcl, l.InternalPriceExcl, l.DongguanPriceExcl, l.HunanPriceExcl, l.OutsourcePriceExcl,
            LineSaving(l.InternalPriceExcl, l.OutsourcePriceExcl, l.Qty), Rate(l.InternalPriceExcl, l.OutsourcePriceExcl),
            Compliance(l.InternalPriceExcl, l.OutsourcePriceExcl))).ToList();
        var complete = lines.Count > 0 && lines.All(l => l.OutsourcePriceExcl is not null);
        return new OrderDetailDto(o.OrderId, o.OrderNo, o.SupplierId, supplier, o.OrderDate, o.DeliveryDate,
            o.Status, o.Remark,
            complete ? lines.Sum(l => l.OutsourcePriceExcl!.Value * (l.Qty ?? 0)) : null,
            complete ? dtos.Sum(l => l.Saving ?? 0) : null, dtos.Any(l => l.Compliance == "超标"),
            complete, dtos, o.ProductionProgress, o.DelayDays, o.DelayReason);
    }

    public async Task<(int orderId, string? error)> CreateAsync(OrderUpsert req)
    {
        var supplier = await db.Suppliers.FindAsync(req.SupplierId);
        if (supplier is null) return (0, "加工厂不存在");
        var lines = (req.Lines ?? []).Where(l => l.ProductId > 0).ToList();
        if (lines.Count == 0) return (0, "至少填一行产品明细");
        if (lines.GroupBy(l => l.ProductId).Any(g => g.Count() > 1)) return (0, "同一款式在一张订单中只能出现一次");
        var orderNo = req.OrderNo?.Trim();
        if (string.IsNullOrWhiteSpace(orderNo)) return (0, "请填订单号");
        if (await db.PurchaseOrders.AnyAsync(o => o.OrderNo == orderNo)) return (0, $"订单号 {orderNo} 已存在");
        var prices = await LoadPricesAsync(lines.Select(l => l.ProductId));
        var missing = lines.Where(l => !prices.ContainsKey(l.ProductId)).Select(l => l.ProductId).Distinct().ToList();
        if (missing.Count > 0) return (0, await MissingMessageAsync(missing));

        var order = new PurchaseOrder
        {
            OrderNo = orderNo, SupplierId = req.SupplierId, OrderDate = req.OrderDate, DeliveryDate = req.DeliveryDate,
            Status = "待核价", Remark = req.Remark, DeptId = supplier.DeptId,
            CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
        };
        db.PurchaseOrders.Add(order);
        await db.SaveChangesAsync();
        foreach (var line in lines)
        {
            var price = prices[line.ProductId];
            db.PurchaseOrderLines.Add(NewLine(order.OrderId, line.ProductId, line.Qty, line.Unit, price));
        }
        await db.SaveChangesAsync();
        return (order.OrderId, null);
    }

    public async Task<(bool ok, string? error)> UpdateAsync(int id, OrderEditReq req)
    {
        var order = await db.PurchaseOrders.FirstOrDefaultAsync(o => o.OrderId == id);
        if (order is null) return (false, "订单不存在");
        var supplier = await db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.SupplierId == req.SupplierId);
        if (supplier is null) return (false, "加工厂不存在");
        var incoming = (req.Lines ?? []).Where(l => l.ProductId > 0).ToList();
        if (incoming.Count == 0) return (false, "至少保留一行产品明细");
        if (incoming.GroupBy(l => l.ProductId).Any(g => g.Count() > 1)) return (false, "同一款式在一张订单中只能出现一次");
        var existing = await db.PurchaseOrderLines.Where(l => l.OrderId == id).OrderBy(l => l.LineId).ToListAsync();
        var existingMap = existing.ToDictionary(l => l.LineId);
        if (incoming.Any(l => l.LineId is not null && !existingMap.ContainsKey(l.LineId.Value)))
            return (false, "订单明细已变化，请刷新后重试");
        var linked = await HasLinkedRecordsAsync(id);
        if (linked && (req.SupplierId != order.SupplierId || incoming.Count != existing.Count || incoming.Any(l =>
            l.LineId is null || existingMap[l.LineId.Value].ProductId != l.ProductId ||
            existingMap[l.LineId.Value].Qty != l.Qty || existingMap[l.LineId.Value].Unit != l.Unit)))
            return (false, "订单已有回货或质检记录，不能修改产品、加工厂或数量");

        var supplierChanged = req.SupplierId != order.SupplierId;
        var changed = incoming.Where(l => l.LineId is null || supplierChanged || existingMap[l.LineId.Value].ProductId != l.ProductId).ToList();
        var prices = await LoadPricesAsync(changed.Select(l => l.ProductId));
        var missing = changed.Where(l => !prices.ContainsKey(l.ProductId)).Select(l => l.ProductId).Distinct().ToList();
        if (missing.Count > 0) return (false, await MissingMessageAsync(missing));
        foreach (var line in incoming)
        {
            var entity = line.LineId is null ? null : existingMap[line.LineId.Value];
            var identityChanged = entity is null || supplierChanged || entity.ProductId != line.ProductId;
            if (entity is null)
            {
                entity = new PurchaseOrderLine { OrderId = id };
                db.PurchaseOrderLines.Add(entity);
            }
            entity.ProductId = line.ProductId;
            entity.Qty = line.Qty;
            entity.Unit = line.Unit;
            if (identityChanged) ApplySnapshot(entity, prices[line.ProductId], clearOutsource: true);
        }
        var kept = incoming.Where(l => l.LineId is not null).Select(l => l.LineId!.Value).ToHashSet();
        db.PurchaseOrderLines.RemoveRange(existing.Where(l => !kept.Contains(l.LineId)));
        order.SupplierId = req.SupplierId;
        order.DeptId = supplier.DeptId;
        order.OrderDate = req.OrderDate;
        order.DeliveryDate = req.DeliveryDate;
        order.DelayReason = Clean(req.DelayReason);
        order.Remark = Clean(req.Remark);
        if (changed.Count > 0) order.Status = "待核价";
        order.UpdatedBy = current.UserId;
        order.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (true, null);
    }

    private async Task<Dictionary<int, ProductQuote>> LoadPricesAsync(IEnumerable<int> productIds)
    {
        var ids = productIds.Distinct().ToList();
        var rows = await db.ProductQuotes.AsNoTracking().Where(q => ids.Contains(q.ProductId))
            .OrderByDescending(q => q.UpdatedAt ?? q.CreatedAt).ToListAsync();
        return rows.GroupBy(q => q.ProductId).ToDictionary(g => g.Key, g => g.First());
    }

    private static PurchaseOrderLine NewLine(int orderId, int productId, decimal? qty, string? unit, ProductQuote price)
    {
        var line = new PurchaseOrderLine { OrderId = orderId, ProductId = productId, Qty = qty, Unit = unit };
        ApplySnapshot(line, price, true);
        return line;
    }
    private static void ApplySnapshot(PurchaseOrderLine line, ProductQuote price, bool clearOutsource)
    {
        line.CustomerQuoteExcl = price.CustomerQuoteExcl;
        line.InternalPriceExcl = price.InternalPriceExcl;
        line.DongguanPriceExcl = price.DongguanPriceExcl;
        line.HunanPriceExcl = price.HunanPriceExcl;
        if (clearOutsource) line.OutsourcePriceExcl = null;
    }
    private async Task<string> MissingMessageAsync(List<int> ids)
    {
        var names = await db.Products.AsNoTracking().Where(p => ids.Contains(p.ProductId))
            .Select(p => (p.SeriesCode ?? p.ProductCode) + " " + p.ProductName).ToListAsync();
        return $"以下款式尚未维护产品核价：{string.Join("、", names)}。请先到产品核价库补齐。";
    }
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private async Task<bool> HasLinkedRecordsAsync(int orderId) =>
        await db.DeliveryNotes.AsNoTracking().AnyAsync(n => n.OrderId == orderId) ||
        await db.QualityInspections.AsNoTracking().AnyAsync(q => q.OrderId == orderId);

    public async Task<(bool ok, string? error)> DeleteAsync(int id)
    {
        var order = await db.PurchaseOrders.FindAsync(id);
        if (order is null) return (false, "订单不存在");
        if (await HasLinkedRecordsAsync(id)) return (false, "订单已有回货或质检记录，不能删除");
        var lineIds = await db.PurchaseOrderLines.Where(l => l.OrderId == id).Select(l => l.LineId).ToListAsync();
        db.OrderPriceHistories.RemoveRange(db.OrderPriceHistories.Where(h => lineIds.Contains(h.LineId)));
        db.PurchaseOrderLines.RemoveRange(db.PurchaseOrderLines.Where(l => l.OrderId == id));
        db.PurchaseOrders.Remove(order);
        await db.SaveChangesAsync();
        return (true, null);
    }
}
