using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Products;

public record ImportRowInput(int RowNo, string? CustomerName, string? Code, string? ProductName,
    decimal? CustomerQuoteExcl, decimal? InternalPriceExcl, decimal? DongguanPriceExcl,
    decimal? HunanPriceExcl, string? Remark);
public record ImportPreviewReq(int DeptId, List<ImportRowInput> Rows);
public record ImportPreviewRow(int RowNo, string CustomerName, string Code, string ProductName,
    decimal? CustomerQuoteExcl, decimal? InternalPriceExcl, decimal? DongguanPriceExcl,
    decimal? HunanPriceExcl, string? Remark, string Status, string? Reason,
    bool WillCreateProduct, bool HasExistingQuote, int? ProductId);
public record ImportPreviewResult(List<ImportPreviewRow> Rows,
    int WillCreateProductCount, int WillWriteCount, int ConflictCount, int DuplicateCount, int WarningCount, int SkipCount);
public record ImportCommitRow(int RowNo, string? CustomerName, string? Code, string? ProductName,
    decimal? CustomerQuoteExcl, decimal? InternalPriceExcl, decimal? DongguanPriceExcl,
    decimal? HunanPriceExcl, string? Remark, bool Overwrite, bool ClearEmpty = false);
public record ImportCommitReq(int DeptId, List<ImportCommitRow> Rows);
public record ImportCommitResult(int CreatedProducts, int WrittenQuotes, int Overwritten, int KeptOld, int Skipped);

/// <summary>非固定模板导入：前端识别任意 Excel 表头，后端负责业务校验、预览和落库。</summary>
public class ProductImportService(AppDbContext db, ICurrentUser current)
{
    private static string Clean(string? value) => (value ?? "").Trim();
    private static string Key(string code, string name) => $"{code}\u0001{name}";

    public async Task<ImportPreviewResult> PreviewAsync(int deptId, List<ImportRowInput> rows)
    {
        deptId = deptId > 0 ? deptId : current.DeptId ?? 0;
        var products = await ProductMapAsync(deptId);
        var productIds = products.Values.ToList();
        var quotes = await db.ProductQuotes.AsNoTracking().Where(q => productIds.Contains(q.ProductId))
            .GroupBy(q => q.ProductId).Select(g => new { ProductId = g.Key, HasPrice = true }).ToDictionaryAsync(x => x.ProductId);
        var lastRows = (rows ?? []).GroupBy(r => Key(Clean(r.Code), Clean(r.ProductName)))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.RowNo).First().RowNo);
        var output = new List<ImportPreviewRow>();
        var newKeys = new HashSet<string>();
        var duplicateKeys = (rows ?? []).GroupBy(r => Key(Clean(r.Code), Clean(r.ProductName)))
            .Where(g => Clean(g.Key).Length > 1 && g.Count() > 1).Select(g => g.Key).ToHashSet();
        int write = 0, conflict = 0, duplicate = 0, warning = 0, skip = 0;
        foreach (var row in rows ?? [])
        {
            var code = Clean(row.Code);
            var name = Clean(row.ProductName);
            var key = Key(code, name);
            string? reason = null;
            if (code.Length == 0 || name.Length == 0) reason = "缺少货号或款式";
            else if (row.InternalPriceExcl is null || row.InternalPriceExcl < 0) reason = "本厂核价为空或不是有效数字";
            else if (row.CustomerQuoteExcl < 0 || row.DongguanPriceExcl < 0 || row.HunanPriceExcl < 0) reason = "价格不能小于0";
            if (reason is not null)
            {
                output.Add(ToPreview(row, code, name, "skip", reason, false, false, null));
                skip++;
                continue;
            }
            var exists = products.TryGetValue(key, out var productId);
            var hasQuote = exists && quotes.ContainsKey(productId);
            if (!exists) newKeys.Add(key);
            var warningText = PriceWarning(row);
            var status = duplicateKeys.Contains(key) && lastRows[key] != row.RowNo
                ? "duplicate"
                : hasQuote ? "conflict" : warningText is not null ? "warning" : "ok";
            var detail = status switch
            {
                "duplicate" => "文件内存在相同货号＋款式，请人工选择使用哪一行",
                "conflict" => JoinReason("系统已有产品价格，请选择跳过或覆盖", warningText),
                _ => warningText
            };
            output.Add(ToPreview(row, code, name, status, detail, !exists, hasQuote, exists ? productId : null));
            if (status == "duplicate") duplicate++;
            else if (hasQuote) conflict++;
            else
            {
                write++;
                if (warningText is not null) warning++;
            }
        }
        return new ImportPreviewResult(output, newKeys.Count, write, conflict, duplicate, warning, skip);
    }

    public async Task<ImportCommitResult> CommitAsync(ImportCommitReq req)
    {
        var deptId = req.DeptId > 0 ? req.DeptId : current.DeptId ?? 0;
        var products = await ProductMapAsync(deptId);
        var valid = (req.Rows ?? []).Where(r => Clean(r.Code).Length > 0 && Clean(r.ProductName).Length > 0 &&
            r.InternalPriceExcl is >= 0 && r.CustomerQuoteExcl is null or >= 0 &&
            r.DongguanPriceExcl is null or >= 0 && r.HunanPriceExcl is null or >= 0)
            .GroupBy(r => Key(Clean(r.Code), Clean(r.ProductName))).Select(g => g.OrderByDescending(x => x.RowNo).First()).ToList();
        var seqByCode = await MaxStyleSequenceAsync(deptId);
        var created = new List<Product>();
        foreach (var row in valid)
        {
            var code = Clean(row.Code);
            var name = Clean(row.ProductName);
            if (products.ContainsKey(Key(code, name))) continue;
            var seq = seqByCode.GetValueOrDefault(code) + 1;
            seqByCode[code] = seq;
            created.Add(new Product
            {
                ProductCode = seq == 1 ? code : $"{code}#{seq}", SeriesCode = code, StyleNo = $"#{seq}",
                ProductName = name, DeptId = deptId, IsActive = true,
                CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
            });
        }
        if (created.Count > 0)
        {
            db.Products.AddRange(created);
            await db.SaveChangesAsync();
            foreach (var p in created) products[Key(p.SeriesCode!, p.ProductName)] = p.ProductId;
        }
        var ids = products.Values.ToList();
        var quoteRows = await db.ProductQuotes.Where(q => ids.Contains(q.ProductId)).ToListAsync();
        var quoteMap = quoteRows.GroupBy(q => q.ProductId).ToDictionary(g => g.Key, g => g.OrderByDescending(q => q.UpdatedAt ?? q.CreatedAt).First());
        int written = 0, overwritten = 0, kept = 0;
        foreach (var row in valid)
        {
            var productId = products[Key(Clean(row.Code), Clean(row.ProductName))];
            if (quoteMap.TryGetValue(productId, out var quote))
            {
                if (!row.Overwrite) { kept++; continue; }
                overwritten++;
                quote.UpdatedBy = current.UserId;
                quote.UpdatedAt = DateTime.UtcNow;
                db.ProductQuotes.RemoveRange(quoteRows.Where(q => q.ProductId == productId && q != quote));
            }
            else
            {
                quote = new ProductQuote
                {
                    ProductId = productId, DeptId = deptId,
                    CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
                };
                db.ProductQuotes.Add(quote);
                quoteMap[productId] = quote;
                written++;
            }
            quote.CustomerName = row.ClearEmpty || !string.IsNullOrWhiteSpace(row.CustomerName)
                ? NullIfEmpty(row.CustomerName) : quote.CustomerName;
            if (row.ClearEmpty || row.CustomerQuoteExcl is not null) quote.CustomerQuoteExcl = row.CustomerQuoteExcl;
            quote.InternalPriceExcl = row.InternalPriceExcl!.Value;
            if (row.ClearEmpty || row.DongguanPriceExcl is not null) quote.DongguanPriceExcl = row.DongguanPriceExcl;
            if (row.ClearEmpty || row.HunanPriceExcl is not null) quote.HunanPriceExcl = row.HunanPriceExcl;
            quote.Remark = row.ClearEmpty || !string.IsNullOrWhiteSpace(row.Remark)
                ? NullIfEmpty(row.Remark) : quote.Remark;
        }
        await db.SaveChangesAsync();
        return new ImportCommitResult(created.Count, written, overwritten, kept, (req.Rows?.Count ?? 0) - valid.Count);
    }

    private static ImportPreviewRow ToPreview(ImportRowInput r, string code, string name, string status,
        string? reason, bool create, bool hasExistingQuote, int? productId) =>
        new(r.RowNo, Clean(r.CustomerName), code, name, r.CustomerQuoteExcl, r.InternalPriceExcl,
            r.DongguanPriceExcl, r.HunanPriceExcl, NullIfEmpty(r.Remark), status, reason, create, hasExistingQuote, productId);
    private static string? PriceWarning(ImportRowInput row)
    {
        if (row.InternalPriceExcl is null or <= 0) return null;
        var warnings = new List<string>();
        if (row.CustomerQuoteExcl is > 0 && (row.CustomerQuoteExcl < row.InternalPriceExcl * 0.5m ||
                                             row.CustomerQuoteExcl > row.InternalPriceExcl * 2m))
            warnings.Add("报客价与本厂核价差异较大");
        if (row.DongguanPriceExcl is > 0 && (row.DongguanPriceExcl < row.InternalPriceExcl * 0.5m ||
                                             row.DongguanPriceExcl > row.InternalPriceExcl * 1.5m))
            warnings.Add("东莞价与本厂核价差异较大");
        if (row.HunanPriceExcl is > 0 && (row.HunanPriceExcl < row.InternalPriceExcl * 0.5m ||
                                          row.HunanPriceExcl > row.InternalPriceExcl * 1.5m))
            warnings.Add("湖南价与本厂核价差异较大");
        return warnings.Count == 0 ? null : string.Join("；", warnings);
    }
    private static string JoinReason(string main, string? extra) =>
        string.IsNullOrWhiteSpace(extra) ? main : $"{main}；{extra}";
    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private async Task<Dictionary<string, int>> ProductMapAsync(int deptId) =>
        (await db.Products.AsNoTracking().Where(p => p.DeptId == deptId)
            .Select(p => new { p.ProductId, Code = p.SeriesCode ?? p.ProductCode, p.ProductName }).ToListAsync())
        .GroupBy(p => Key(p.Code, p.ProductName)).ToDictionary(g => g.Key, g => g.First().ProductId);
    private async Task<Dictionary<string, int>> MaxStyleSequenceAsync(int deptId) =>
        (await db.Products.AsNoTracking().Where(p => p.DeptId == deptId)
            .Select(p => new { Code = p.SeriesCode ?? p.ProductCode, p.StyleNo }).ToListAsync())
        .GroupBy(p => p.Code).ToDictionary(g => g.Key,
            g => g.Select(x => int.TryParse((x.StyleNo ?? "").TrimStart('#'), out var n) ? n : 0).DefaultIfEmpty().Max());
}
