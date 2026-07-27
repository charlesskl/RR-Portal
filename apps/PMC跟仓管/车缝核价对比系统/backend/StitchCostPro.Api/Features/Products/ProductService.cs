using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Products;

public record ProductDto(int ProductId, string ProductCode, string ProductName, string? Spec,
    int DeptId, bool IsActive, string? ExtMainId, string? SeriesCode, string? StyleNo);
public record ProductUpsert(string ProductCode, string ProductName, string? Spec, int DeptId,
    bool IsActive, string? ExtMainId, string? SeriesCode, string? StyleNo);

/// <summary>产品库列表行：一个货号(系列)一行。Code=货号，StyleCount=该货号下款数。</summary>
public record ProductSeriesRow(string Code, int StyleCount, bool IsActive, DateTime LastModified, string? LastModifiedBy);
public record ProductSeriesDeleteResult(int ProductCount, int QuoteCount, int AliasCount);

/// <summary>批量建款的单个款。</summary>
public record SeriesCreateItem(string ProductName, string? Spec);
/// <summary>新建货号：一个货号一次建多个款。</summary>
public record SeriesCreate(string SeriesCode, int DeptId, bool IsActive, List<SeriesCreateItem> Items);

public class ProductService(AppDbContext db, ICurrentUser current)
{
    public async Task<PagedResult<ProductDto>> ListAsync(string? keyword, int? deptId, int page, int pageSize)
    {
        var q = db.Products.AsNoTracking();
        if (deptId is not null) q = q.Where(p => p.DeptId == deptId);
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(p => p.ProductCode.Contains(keyword) || p.ProductName.Contains(keyword));

        var total = await q.CountAsync();
        var items = await q.OrderByDescending(p => p.ProductId)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new ProductDto(p.ProductId, p.ProductCode, p.ProductName, p.Spec, p.DeptId,
                p.IsActive, p.ExtMainId, p.SeriesCode, p.StyleNo))
            .ToListAsync();
        return new PagedResult<ProductDto> { Items = items, Total = total, Page = page, PageSize = pageSize };
    }

    /// <summary>产品库列表：按"货号(系列)"分组，款数=该货号下款数。修改人查 SysUser.DisplayName。</summary>
    public async Task<PagedResult<ProductSeriesRow>> SeriesSummaryAsync(string? keyword, int? deptId, bool archived, int page, int pageSize)
    {
        var q = db.Products.AsNoTracking();
        if (deptId is not null) q = q.Where(p => p.DeptId == deptId);
        q = q.Where(p => archived ? !p.IsActive : p.IsActive);
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(p => (p.SeriesCode ?? p.ProductCode).Contains(keyword) || p.ProductName.Contains(keyword));

        // v1：产品档案量级有限，先取出再内存按货号分组，逻辑直白可靠；日后量大可改数据库侧分组。
        var rows = await q.Select(p => new
        {
            Key = p.SeriesCode ?? p.ProductCode,
            p.IsActive,
            Modified = p.UpdatedAt ?? p.CreatedAt,
            ModBy = p.UpdatedBy ?? p.CreatedBy,
        }).ToListAsync();

        var users = await db.SysUsers.AsNoTracking().ToDictionaryAsync(u => u.UserId, u => u.DisplayName);

        var groups = rows.GroupBy(r => r.Key)
            .Select(g =>
            {
                var latest = g.OrderByDescending(x => x.Modified).First();
                string? modName = latest.ModBy is int uid && users.TryGetValue(uid, out var n) ? n : null;
                return new ProductSeriesRow(g.Key, g.Count(), g.Any(x => x.IsActive), latest.Modified, modName);
            })
            .OrderByDescending(r => r.LastModified)
            .ToList();

        var items = groups.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return new PagedResult<ProductSeriesRow> { Items = items, Total = groups.Count, Page = page, PageSize = pageSize };
    }

    /// <summary>按货号逻辑作废/恢复全部款；保留历史核价、订单和品质数据。</summary>
    public async Task<(int count, string? error)> SetSeriesActiveAsync(string code, bool isActive)
    {
        code = code.Trim();
        if (string.IsNullOrWhiteSpace(code)) return (0, "货号不能为空");

        var rows = await db.Products
            .Where(p => (p.SeriesCode ?? p.ProductCode) == code)
            .ToListAsync();
        if (rows.Count == 0) return (0, $"货号 {code} 不存在");

        foreach (var p in rows)
        {
            p.IsActive = isActive;
            p.UpdatedBy = current.UserId;
            p.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
        return (rows.Count, null);
    }

    /// <summary>
    /// 永久删除一个货号下的全部款式。历史订单、品质或回货仍有关联时必须拦截；
    /// 产品自身的核价与导入别名在确认无业务引用后随货号一并删除。
    /// </summary>
    public async Task<(ProductSeriesDeleteResult? result, string? error)> DeleteSeriesAsync(string code)
    {
        code = code.Trim();
        if (string.IsNullOrWhiteSpace(code)) return (null, "货号不能为空");

        var products = await db.Products
            .Where(p => (p.SeriesCode ?? p.ProductCode) == code)
            .ToListAsync();
        if (products.Count == 0) return (null, $"货号 {code} 不存在");

        var productIds = products.Select(p => p.ProductId).ToList();
        var lineIds = await db.PurchaseOrderLines
            .Where(l => productIds.Contains(l.ProductId))
            .Select(l => l.LineId)
            .ToListAsync();

        var orderCount = await db.PurchaseOrderLines
            .Where(l => productIds.Contains(l.ProductId))
            .Select(l => l.OrderId)
            .Distinct()
            .CountAsync();
        var qualityCount = await db.QualityInspections
            .CountAsync(q => productIds.Contains(q.ProductId));
        var deliveryCount = lineIds.Count == 0
            ? 0
            : await db.DeliveryInspections
                .Where(i => lineIds.Contains(i.LineId))
                .Select(i => i.DeliveryNoteId)
                .Distinct()
                .CountAsync();

        if (orderCount > 0 || qualityCount > 0 || deliveryCount > 0)
        {
            var linked = new List<string>();
            if (orderCount > 0) linked.Add($"{orderCount} 张外发订单");
            if (qualityCount > 0) linked.Add($"{qualityCount} 条质检记录");
            if (deliveryCount > 0) linked.Add($"{deliveryCount} 个回货批次");
            return (null, $"货号 {code} 仍关联{string.Join("、", linked)}，请先删除关联业务后再删除货号");
        }

        var quotes = await db.ProductQuotes.Where(q => productIds.Contains(q.ProductId)).ToListAsync();
        var aliases = await db.ProductImportAliases.Where(a => productIds.Contains(a.ProductId)).ToListAsync();
        db.ProductQuotes.RemoveRange(quotes);
        db.ProductImportAliases.RemoveRange(aliases);
        db.Products.RemoveRange(products);
        await db.SaveChangesAsync();

        return (new ProductSeriesDeleteResult(products.Count, quotes.Count, aliases.Count), null);
    }

    public async Task<ProductDto?> GetAsync(int id)
    {
        var p = await db.Products.FindAsync(id);
        return p is null ? null : new ProductDto(p.ProductId, p.ProductCode, p.ProductName, p.Spec,
            p.DeptId, p.IsActive, p.ExtMainId, p.SeriesCode, p.StyleNo);
    }

    public async Task<(ProductDto? dto, string? error)> CreateAsync(ProductUpsert req)
    {
        if (await db.Products.AnyAsync(p => p.ProductCode == req.ProductCode && p.DeptId == req.DeptId))
            return (null, $"该部门下货号 {req.ProductCode} 已存在");

        var p = new Product
        {
            ProductCode = req.ProductCode,
            ProductName = req.ProductName,
            Spec = req.Spec,
            DeptId = req.DeptId,
            IsActive = req.IsActive,
            ExtMainId = req.ExtMainId,
            SeriesCode = req.SeriesCode,
            StyleNo = req.StyleNo,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return (await GetAsync(p.ProductId), null);
    }

    /// <summary>新建货号：一个货号(SeriesCode)一次建多个款。款号 #1/#2… 自动排，ProductCode 自动生成。</summary>
    public async Task<(int count, string? error)> CreateSeriesAsync(SeriesCreate req)
    {
        var code = req.SeriesCode?.Trim();
        if (string.IsNullOrWhiteSpace(code)) return (0, "货号不能为空");

        var items = (req.Items ?? new())
            .Where(i => !string.IsNullOrWhiteSpace(i.ProductName))
            .Select(i => new SeriesCreateItem(i.ProductName.Trim(), string.IsNullOrWhiteSpace(i.Spec) ? null : i.Spec!.Trim()))
            .ToList();
        if (items.Count == 0) return (0, "至少填一个款名");

        // 该货号下已有的款（用于自动排款号 + 同款名去重）。老数据 SeriesCode 可能为空，回退用 ProductCode 归组。
        var existing = await db.Products
            .Where(p => p.DeptId == req.DeptId && (p.SeriesCode ?? p.ProductCode) == code)
            .Select(p => new { p.ProductName, p.StyleNo })
            .ToListAsync();

        var existingNames = existing.Select(e => e.ProductName).ToHashSet();
        // 现有最大款号序号（"#3" → 3），新款从它往后排，避免删中间号后撞号。
        int seq = existing
            .Select(e => int.TryParse((e.StyleNo ?? "").TrimStart('#'), out var n) ? n : 0)
            .DefaultIfEmpty(0).Max();

        var toAdd = new List<Product>();
        var batchNames = new HashSet<string>();
        foreach (var it in items)
        {
            if (existingNames.Contains(it.ProductName))
                return (0, $"货号 {code} 下已存在款「{it.ProductName}」");
            if (!batchNames.Add(it.ProductName))
                return (0, $"本次提交里款「{it.ProductName}」重复");

            seq++;
            var styleNo = $"#{seq}";
            toAdd.Add(new Product
            {
                // 第 1 款 ProductCode 就用货号本身；后续用 货号#序号，与历史数据(15783 / 15783#2)一致。
                ProductCode = seq == 1 ? code : $"{code}{styleNo}",
                SeriesCode = code,
                StyleNo = styleNo,
                ProductName = it.ProductName,
                Spec = it.Spec,
                DeptId = req.DeptId,
                IsActive = req.IsActive,
                CreatedBy = current.UserId,
                CreatedAt = DateTime.UtcNow,
            });
        }

        db.Products.AddRange(toAdd);
        await db.SaveChangesAsync();
        return (toAdd.Count, null);
    }

    public async Task<(ProductDto? dto, string? error)> UpdateAsync(int id, ProductUpsert req)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return (null, "货号不存在");
        if (await db.Products.AnyAsync(x => x.ProductCode == req.ProductCode && x.DeptId == req.DeptId && x.ProductId != id))
            return (null, $"该部门下货号 {req.ProductCode} 已被占用");

        p.ProductCode = req.ProductCode;
        p.ProductName = req.ProductName;
        p.Spec = req.Spec;
        p.DeptId = req.DeptId;
        p.IsActive = req.IsActive;
        p.ExtMainId = req.ExtMainId;
        p.SeriesCode = req.SeriesCode;
        p.StyleNo = req.StyleNo;
        p.UpdatedBy = current.UserId;
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (await GetAsync(id), null);
    }
}
