using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Products;

public record ProductPriceDto(
    int ProductId, string? StyleNo, string ProductName, string? CustomerName,
    decimal? CustomerQuoteExcl, decimal InternalPriceExcl,
    decimal? DongguanPriceExcl, decimal? HunanPriceExcl, string? Remark);

public record ProductPriceSaveReq(
    int DeptId, string? CustomerName, decimal? CustomerQuoteExcl, decimal InternalPriceExcl,
    decimal? DongguanPriceExcl, decimal? HunanPriceExcl, string? Remark);

/// <summary>产品价格库：每个款式只保存一组产品总价，不再拆分工序。</summary>
public class ProductQuoteService(AppDbContext db, ICurrentUser current)
{
    public async Task<List<ProductPriceDto>> GetBySeriesAsync(string seriesCode, int? deptId)
    {
        var prods = await db.Products.AsNoTracking()
            .Where(p => (p.SeriesCode ?? p.ProductCode) == seriesCode && (deptId == null || p.DeptId == deptId))
            .OrderBy(p => p.StyleNo).ThenBy(p => p.ProductId)
            .Select(p => new { p.ProductId, p.StyleNo, p.ProductName }).ToListAsync();
        var ids = prods.Select(p => p.ProductId).ToList();
        var quotes = await db.ProductQuotes.AsNoTracking().Where(q => ids.Contains(q.ProductId))
            .OrderByDescending(q => q.UpdatedAt ?? q.CreatedAt).ToListAsync();

        return prods.Select(p =>
        {
            var q = quotes.FirstOrDefault(x => x.ProductId == p.ProductId);
            return new ProductPriceDto(p.ProductId, p.StyleNo, p.ProductName, q?.CustomerName,
                q?.CustomerQuoteExcl, q?.InternalPriceExcl ?? 0m,
                q?.DongguanPriceExcl, q?.HunanPriceExcl, q?.Remark);
        }).ToList();
    }

    public async Task<ProductPriceDto?> GetByProductAsync(int productId)
    {
        var p = await db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.ProductId == productId);
        if (p is null) return null;
        var q = await db.ProductQuotes.AsNoTracking().Where(x => x.ProductId == productId)
            .OrderByDescending(x => x.UpdatedAt ?? x.CreatedAt)
            .FirstOrDefaultAsync();
        return new ProductPriceDto(p.ProductId, p.StyleNo, p.ProductName, q?.CustomerName,
            q?.CustomerQuoteExcl, q?.InternalPriceExcl ?? 0m, q?.DongguanPriceExcl, q?.HunanPriceExcl, q?.Remark);
    }

    public async Task<(bool ok, string? error)> SaveAsync(int productId, ProductPriceSaveReq req)
    {
        if (req.InternalPriceExcl < 0 || req.CustomerQuoteExcl < 0 || req.DongguanPriceExcl < 0 || req.HunanPriceExcl < 0)
            return (false, "价格不能小于 0");
        if (!await db.Products.AnyAsync(p => p.ProductId == productId && p.DeptId == req.DeptId))
            return (false, "产品不存在或不属于当前部门");

        var existing = await db.ProductQuotes.Where(q => q.ProductId == productId).ToListAsync();
        var quote = existing.FirstOrDefault() ?? new ProductQuote
        {
            ProductId = productId, DeptId = req.DeptId,
            CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
        };
        if (quote.QuoteId == 0) db.ProductQuotes.Add(quote);
        quote.CustomerName = Clean(req.CustomerName);
        quote.CustomerQuoteExcl = req.CustomerQuoteExcl;
        quote.InternalPriceExcl = req.InternalPriceExcl;
        quote.DongguanPriceExcl = req.DongguanPriceExcl;
        quote.HunanPriceExcl = req.HunanPriceExcl;
        quote.Remark = Clean(req.Remark);
        quote.UpdatedBy = current.UserId;
        quote.UpdatedAt = DateTime.UtcNow;
        db.ProductQuotes.RemoveRange(existing.Where(x => x != quote));
        await db.SaveChangesAsync();
        return (true, null);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
