using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.PriceBoard;

public record PriceBoardItem(
    int OrderId, string OrderNo, string Series, string Style, int ProductId, string Supplier,
    decimal? CustomerQuote, decimal SelfUnit, decimal OutUnit, decimal? OutSelfRate,
    decimal Qty, decimal SaveValue);

// 按产品看：一张订单中的一个款式一行
public record PriceBoardByStyle(
    int LineId, int OrderId, string OrderNo, int ProductId, string Series, string Style,
    decimal? CustomerQuote, decimal SelfUnitSum, decimal OutUnitSum, decimal? OutSelfRate,
    decimal Qty, decimal SaveValue, bool Over);

public record PriceBoardBySupplier(
    int SupplierId, string Supplier, int OrderCount, int StyleCount, decimal Qty,
    decimal OutValue, decimal SelfValue, decimal SaveValue, decimal? SavingRate,
    int OverPriceCount,
    List<PriceBoardItem> Items);

public record PriceBoardDto(
    string From, string To, int OutStyleCount, decimal OutQty,
    decimal SelfValueTotal, decimal OutValueTotal, decimal SaveValueTotal,
    List<PriceBoardByStyle> ByStyle, List<PriceBoardBySupplier> BySupplier);

/// <summary>订单产品级核价对比；不再按工序聚合。</summary>
public class PriceBoardService(AppDbContext db)
{
    public async Task<PriceBoardDto> GetAsync(DateOnly from, DateOnly to)
    {
        var d0 = from;
        var d1 = to;
        var rows = await (
            from l in db.PurchaseOrderLines.AsNoTracking()
            join o in db.PurchaseOrders.AsNoTracking() on l.OrderId equals o.OrderId
            join p in db.Products.AsNoTracking() on l.ProductId equals p.ProductId
            join s in db.Suppliers.AsNoTracking() on o.SupplierId equals s.SupplierId
            where o.OrderDate >= d0 && o.OrderDate <= d1
                && o.Status != "待核价"
                && l.OutsourcePriceExcl != null
                && l.InternalPriceExcl != null && l.InternalPriceExcl > 0
            select new Row(l.LineId, o.OrderId, o.OrderNo, o.OrderDate, o.SupplierId, s.SupplierName,
                l.ProductId, p.SeriesCode ?? p.ProductCode, p.ProductName,
                l.CustomerQuoteExcl, l.Qty ?? 0m, l.OutsourcePriceExcl ?? 0m, l.InternalPriceExcl ?? 0m)
        ).ToListAsync();

        static decimal R2(decimal n) => Math.Round(n, 2);
        static decimal R4(decimal n) => Math.Round(n, 4);
        static decimal? Ratio(decimal self, decimal value) => self == 0 ? null : Math.Round(value / self * 100m, 2);

        var byStyle = rows.Select(r =>
        {
            var save = (r.SelfUnit - r.OutUnit) * r.Qty;
            return new PriceBoardByStyle(r.LineId, r.OrderId, r.OrderNo, r.ProductId, r.Series, r.Style,
                r.CustomerQuote, R4(r.SelfUnit), R4(r.OutUnit), Ratio(r.SelfUnit, r.OutUnit),
                r.Qty, R2(save), r.OutUnit >= r.SelfUnit);
        }).OrderByDescending(x => x.OrderId).ThenBy(x => x.ProductId).ToList();

        var bySupplier = rows.GroupBy(r => r.SupplierId).Select(g =>
        {
            var selfValue = g.Sum(x => x.SelfUnit * x.Qty);
            var outValue = g.Sum(x => x.OutUnit * x.Qty);
            var save = selfValue - outValue;
            var items = g.OrderByDescending(x => x.OrderDate).Select(x => new PriceBoardItem(
                x.OrderId, x.OrderNo, x.Series, x.Style, x.ProductId, x.SupplierName,
                x.CustomerQuote, R4(x.SelfUnit), R4(x.OutUnit), Ratio(x.SelfUnit, x.OutUnit),
                x.Qty, R2((x.SelfUnit - x.OutUnit) * x.Qty))).ToList();
            return new PriceBoardBySupplier(g.Key, g.First().SupplierName,
                g.Select(x => x.OrderId).Distinct().Count(),
                g.Select(x => x.ProductId).Distinct().Count(),
                g.Sum(x => x.Qty),
                R2(outValue), R2(selfValue), R2(save), Ratio(selfValue, save),
                g.Count(x => x.OutUnit >= x.SelfUnit), items);
        }).OrderByDescending(x => x.OutValue).ToList();

        var selfTotal = rows.Sum(r => r.SelfUnit * r.Qty);
        var outTotal = rows.Sum(r => r.OutUnit * r.Qty);
        return new PriceBoardDto(from.ToString("yyyy-MM-dd"), to.ToString("yyyy-MM-dd"),
            rows.Select(r => r.ProductId).Distinct().Count(), rows.Sum(r => r.Qty),
            R2(selfTotal), R2(outTotal), R2(selfTotal - outTotal), byStyle, bySupplier);
    }

    private record Row(int LineId, int OrderId, string OrderNo, DateOnly OrderDate,
        int SupplierId, string SupplierName, int ProductId, string Series, string Style,
        decimal? CustomerQuote, decimal Qty, decimal OutUnit, decimal SelfUnit);
}
