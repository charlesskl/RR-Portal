using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.PurchaseOrders;

public record OrderImportLineInput(
    int RowNo, string? ProductCode, string? ProductName, decimal? Qty, string? Unit,
    decimal? UnitPrice, bool PriceIncludesTax, int? SelectedProductId = null);
public record OrderImportInput(
    string? SourceFile, string? OrderNo, string? SupplierName, DateOnly? OrderDate,
    DateOnly? DeliveryDate, string? Remark, List<OrderImportLineInput> Lines);
public record OrderImportPreviewLine(
    int RowNo, string ProductCode, string ProductName, decimal? Qty, string? Unit,
    decimal? SourceUnitPrice, decimal? OutsourcePriceExcl, int? ProductId, string Status, string? Reason,
    string? MatchType, List<OrderImportProductCandidate> Candidates);
public record OrderImportProductCandidate(
    int ProductId, string ProductCode, string ProductName, decimal Similarity, bool IsActive, bool HasQuote);
public record OrderImportPreviewOrder(
    string SourceFile, string OrderNo, string SupplierName, DateOnly? OrderDate, DateOnly? DeliveryDate,
    string? Remark, int? SupplierId, int? ExistingOrderId, string Status, string? Reason,
    List<OrderImportPreviewLine> Lines);
public record OrderImportPreviewReq(List<OrderImportInput> Orders);
public record OrderImportPreviewResult(
    List<OrderImportPreviewOrder> Orders, int ReadyCount, int ConflictCount, int ErrorCount);
public record OrderImportCommitOrder(OrderImportInput Order, bool Overwrite);
public record OrderImportCommitReq(List<OrderImportCommitOrder> Orders);
public record OrderImportCommitResult(int Created, int Overwritten, int Skipped, int Failed);

public class PurchaseOrderImportService(AppDbContext db, ICurrentUser current)
{
    private static string Clean(string? value) => (value ?? "").Trim();
    private static string SupplierKey(string? value) =>
        Clean(value).Replace(" ", "").Replace("　", "").ToUpperInvariant();
    private static List<Supplier> MatchSuppliers(IEnumerable<Supplier> suppliers, string inputName)
    {
        var inputKey = SupplierKey(inputName);
        var exact = suppliers.Where(s => SupplierKey(s.SupplierName) == inputKey).ToList();
        if (exact.Count > 0) return exact;
        if (inputKey.Length < 2) return [];
        return suppliers.Where(s =>
        {
            var systemKey = SupplierKey(s.SupplierName);
            return systemKey.Length >= 2 &&
                (inputKey.Contains(systemKey, StringComparison.OrdinalIgnoreCase) ||
                 systemKey.Contains(inputKey, StringComparison.OrdinalIgnoreCase));
        }).ToList();
    }
    private static string ProductKey(string code, string name) =>
        $"{Clean(code).ToUpperInvariant()}\u0001{Clean(name).Replace(" ", "")}";
    private static string NameKey(string? value)
    {
        var key = Clean(value).Replace(" ", "").Replace("　", "")
            .Replace("（", "(").Replace("）", ")").ToUpperInvariant();
        key = System.Text.RegularExpressions.Regex.Replace(key,
            @"^\d+(?:\.\d+)?(?:[""寸]|INCH)?(?:#\d+)?", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return System.Text.RegularExpressions.Regex.Replace(key, @"[#""'._\-()/\\]", "");
    }
    private static decimal Similarity(string? left, string? right)
    {
        var a = NameKey(left);
        var b = NameKey(right);
        if (a == b) return 1m;
        if (a.Length == 0 || b.Length == 0) return 0m;
        var costs = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var previous = costs[0];
            costs[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var old = costs[j];
                costs[j] = Math.Min(Math.Min(costs[j] + 1, costs[j - 1] + 1),
                    previous + (a[i - 1] == b[j - 1] ? 0 : 1));
                previous = old;
            }
        }
        return Math.Round(1m - (decimal)costs[b.Length] / Math.Max(a.Length, b.Length), 4);
    }
    private static decimal? ExcludingTax(decimal? price, bool includesTax) =>
        price is null ? null : Math.Round(includesTax ? price.Value / 1.13m : price.Value, 4);

    public async Task<OrderImportPreviewResult> PreviewAsync(List<OrderImportInput>? input)
    {
        var orders = input ?? [];
        var suppliers = await db.Suppliers.AsNoTracking().Where(s => s.IsActive).ToListAsync();
        var products = await db.Products.AsNoTracking().ToListAsync();
        var productMap = products.Where(p => p.IsActive)
            .GroupBy(p => ProductKey(p.SeriesCode ?? p.ProductCode, p.ProductName))
            .ToDictionary(g => g.Key, g => g.First());
        var quoteProductIds = await db.ProductQuotes.AsNoTracking().Select(q => q.ProductId).ToListAsync();
        var quoted = quoteProductIds.ToHashSet();
        var aliases = await db.ProductImportAliases.AsNoTracking().ToListAsync();
        var orderNos = orders.Select(o => Clean(o.OrderNo)).Where(x => x.Length > 0).Distinct().ToList();
        var existing = await db.PurchaseOrders.AsNoTracking().Where(o => orderNos.Contains(o.OrderNo))
            .ToDictionaryAsync(o => o.OrderNo);
        var linkedIds = await LinkedOrderIdsAsync(existing.Values.Select(o => o.OrderId));
        var lastOccurrence = orders.Select((order, index) => new { OrderNo = Clean(order.OrderNo), index })
            .Where(x => x.OrderNo.Length > 0).GroupBy(x => x.OrderNo)
            .ToDictionary(g => g.Key, g => g.Max(x => x.index));

        var output = new List<OrderImportPreviewOrder>();
        for (var index = 0; index < orders.Count; index++)
        {
            var order = orders[index];
            var orderNo = Clean(order.OrderNo);
            var supplierName = Clean(order.SupplierName);
            var supplierMatches = MatchSuppliers(suppliers, supplierName);
            var supplier = supplierMatches.Count == 1 ? supplierMatches[0] : null;
            string? orderError = null;
            if (orderNo.Length == 0) orderError = "缺少订单编号";
            else if (lastOccurrence[orderNo] != index) orderError = "本批文件中订单编号重复，默认使用最后一份";
            else if (supplierName.Length == 0) orderError = "缺少加工厂";
            else if (supplierMatches.Count > 1)
                orderError = $"加工厂名称匹配到多个结果：{string.Join("、", supplierMatches.Select(s => s.SupplierName))}";
            else if (supplier is null) orderError = $"系统中找不到加工厂：{supplierName}";
            else if (order.OrderDate is null) orderError = "缺少下单日期";
            else if ((order.Lines?.Count ?? 0) == 0) orderError = "订单没有产品明细";

            var lineRows = new List<OrderImportPreviewLine>();
            foreach (var line in order.Lines ?? [])
            {
                var code = Clean(line.ProductCode);
                var name = Clean(line.ProductName);
                var sameCode = products.Where(p =>
                    string.Equals(Clean(p.SeriesCode ?? p.ProductCode), code, StringComparison.OrdinalIgnoreCase)).ToList();
                var candidates = sameCode.Select(p => new OrderImportProductCandidate(
                        p.ProductId, Clean(p.SeriesCode ?? p.ProductCode), p.ProductName,
                        Similarity(name, p.ProductName), p.IsActive, quoted.Contains(p.ProductId)))
                    .OrderByDescending(x => x.IsActive && x.HasQuote)
                    .ThenByDescending(x => x.Similarity).ThenBy(x => x.ProductName).Take(8).ToList();
                Product? product = null;
                string? matchType = null;
                if (line.SelectedProductId is int selectedId)
                {
                    product = sameCode.FirstOrDefault(p => p.ProductId == selectedId);
                    if (product is not null) matchType = "manual";
                }
                if (product is null)
                {
                    var alias = aliases.FirstOrDefault(a =>
                        string.Equals(Clean(a.ProductCode), code, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(Clean(a.ExternalName), name, StringComparison.OrdinalIgnoreCase));
                    product = alias is null ? null : sameCode.FirstOrDefault(p => p.ProductId == alias.ProductId);
                    if (product is not null) matchType = "alias";
                }
                if (product is null && productMap.TryGetValue(ProductKey(code, name), out var exact))
                {
                    product = exact;
                    matchType = "exact";
                }
                if (product is null)
                {
                    var normalized = sameCode.Where(p => NameKey(p.ProductName) == NameKey(name)).ToList();
                    if (normalized.Count == 1) { product = normalized[0]; matchType = "normalized"; }
                }
                if (product is null)
                {
                    var recommended = candidates.Where(x => x.IsActive && x.HasQuote && x.Similarity >= 0.9m).ToList();
                    if (recommended.Count == 1)
                    {
                        product = sameCode.First(p => p.ProductId == recommended[0].ProductId);
                        matchType = "suggested";
                    }
                }
                var price = ExcludingTax(line.UnitPrice, line.PriceIncludesTax);
                string? lineError = null;
                if (code.Length == 0 || name.Length == 0) lineError = "缺少货号或款式";
                else if (product is null && sameCode.Count == 0) lineError = "系统产品库中找不到该货号";
                else if (product is null) lineError = "款式名称未能确定，请从候选款式中选择";
                else if (!product.IsActive) lineError = $"匹配到“{product.ProductName}”，但该产品已停用";
                else if (!quoted.Contains(product.ProductId)) lineError = $"匹配到“{product.ProductName}”，但尚未维护产品核价";
                else if (line.Qty is null or <= 0) lineError = "数量必须大于0";
                else if (price is null or < 0) lineError = "外发单价为空或无效";
                lineRows.Add(new OrderImportPreviewLine(
                    line.RowNo, code, name, line.Qty, Clean(line.Unit), line.UnitPrice, price,
                    product?.ProductId, lineError is null ? "ok" : "error", lineError, matchType, candidates));
            }
            lineRows = lineRows
                .GroupBy(line => line.Status == "ok" && line.ProductId is not null
                    ? $"{line.ProductId}\u0001{line.OutsourcePriceExcl}"
                    : $"row\u0001{line.RowNo}")
                .Select(group =>
                {
                    var first = group.First();
                    if (group.Count() == 1) return first;
                    return first with
                    {
                        Qty = group.Sum(line => line.Qty ?? 0),
                        MatchType = "merged",
                        Reason = $"已合并 Excel 第 {string.Join("、", group.Select(line => line.RowNo))} 行"
                    };
                })
                .ToList();
            if (orderError is null && lineRows.Any(l => l.Status == "error"))
                orderError = "存在错误明细";
            if (orderError is null && lineRows.GroupBy(l => l.ProductId).Any(g => g.Key is not null && g.Count() > 1))
                orderError = "同一款式存在不同单价，请人工确认";

            existing.TryGetValue(orderNo, out var oldOrder);
            var status = orderError is not null ? "error" : oldOrder is not null ? "conflict" : "ok";
            var reason = orderError ?? (oldOrder is null ? null :
                linkedIds.Contains(oldOrder.OrderId)
                    ? "系统已有该订单，且已经发生回货或质检，不能覆盖"
                    : "系统已有该订单，请选择跳过或覆盖");
            if (oldOrder is not null && linkedIds.Contains(oldOrder.OrderId)) status = "error";
            output.Add(new OrderImportPreviewOrder(
                Clean(order.SourceFile), orderNo, supplierName, order.OrderDate, order.DeliveryDate,
                Clean(order.Remark), supplier?.SupplierId, oldOrder?.OrderId, status, reason, lineRows));
        }
        return new OrderImportPreviewResult(
            output, output.Count(x => x.Status == "ok"), output.Count(x => x.Status == "conflict"),
            output.Count(x => x.Status == "error"));
    }

    public async Task<OrderImportCommitResult> CommitAsync(List<OrderImportCommitOrder>? input)
    {
        var items = input ?? [];
        var preview = await PreviewAsync(items.Select(x => x.Order).ToList());
        var productNames = await db.Products.AsNoTracking()
            .ToDictionaryAsync(p => p.ProductId, p => p.ProductName);
        var decisions = items.Select((x, i) => new { x.Overwrite, Index = i }).ToDictionary(x => x.Index, x => x.Overwrite);
        var created = 0;
        var overwritten = 0;
        var skipped = 0;
        var failed = 0;
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync() : null;
        for (var index = 0; index < preview.Orders.Count; index++)
        {
            var checkedOrder = preview.Orders[index];
            if (checkedOrder.Status == "error") { failed++; continue; }
            if (checkedOrder.Status == "conflict" && !decisions[index]) { skipped++; continue; }

            PurchaseOrder entity;
            if (checkedOrder.ExistingOrderId is int existingId)
            {
                entity = await db.PurchaseOrders.SingleAsync(o => o.OrderId == existingId);
                var oldLineIds = await db.PurchaseOrderLines.Where(l => l.OrderId == existingId)
                    .Select(l => l.LineId).ToListAsync();
                db.OrderPriceHistories.RemoveRange(db.OrderPriceHistories.Where(h => oldLineIds.Contains(h.LineId)));
                db.PurchaseOrderLines.RemoveRange(db.PurchaseOrderLines.Where(l => l.OrderId == existingId));
                await db.SaveChangesAsync();
                overwritten++;
            }
            else
            {
                entity = new PurchaseOrder
                {
                    OrderNo = checkedOrder.OrderNo,
                    CreatedBy = current.UserId,
                    CreatedAt = DateTime.UtcNow,
                };
                db.PurchaseOrders.Add(entity);
                created++;
            }
            var supplier = await db.Suppliers.AsNoTracking().SingleAsync(s => s.SupplierId == checkedOrder.SupplierId);
            entity.SupplierId = supplier.SupplierId;
            entity.DeptId = supplier.DeptId;
            entity.OrderDate = checkedOrder.OrderDate!.Value;
            entity.DeliveryDate = checkedOrder.DeliveryDate;
            entity.Remark = string.IsNullOrWhiteSpace(checkedOrder.Remark) ? null : checkedOrder.Remark;
            entity.Status = "已下单";
            entity.ProductionProgress = 0;
            entity.DelayDays = 0;
            entity.DelayReason = null;
            entity.UpdatedBy = current.UserId;
            entity.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            var productIds = checkedOrder.Lines.Select(l => l.ProductId!.Value).ToList();
            var quoteMap = await db.ProductQuotes.AsNoTracking().Where(q => productIds.Contains(q.ProductId))
                .ToDictionaryAsync(q => q.ProductId);
            foreach (var line in checkedOrder.Lines)
            {
                var quote = quoteMap[line.ProductId!.Value];
                var orderLine = new PurchaseOrderLine
                {
                    OrderId = entity.OrderId,
                    ProductId = line.ProductId.Value,
                    Qty = line.Qty,
                    Unit = string.IsNullOrWhiteSpace(line.Unit) ? null : line.Unit,
                    OutsourcePriceExcl = line.OutsourcePriceExcl,
                    CustomerQuoteExcl = quote.CustomerQuoteExcl,
                    InternalPriceExcl = quote.InternalPriceExcl,
                    DongguanPriceExcl = quote.DongguanPriceExcl,
                    HunanPriceExcl = quote.HunanPriceExcl,
                };
                db.PurchaseOrderLines.Add(orderLine);
                await db.SaveChangesAsync();
                db.OrderPriceHistories.Add(new OrderPriceHistory
                {
                    LineId = orderLine.LineId,
                    OldPriceExcl = null,
                    NewPriceExcl = line.OutsourcePriceExcl!.Value,
                    ChangeReason = $"Excel导入（{checkedOrder.SourceFile}）",
                    ChangedBy = current.UserId,
                    ChangedAt = DateTime.UtcNow,
                });
                if (!string.Equals(NameKey(line.ProductName), NameKey(
                        productNames[line.ProductId.Value]), StringComparison.Ordinal) ||
                    line.MatchType is "manual" or "suggested" or "normalized")
                {
                    var aliasCode = Clean(line.ProductCode);
                    var aliasName = Clean(line.ProductName);
                    var oldAlias = await db.ProductImportAliases.FirstOrDefaultAsync(a =>
                        a.ProductCode == aliasCode && a.ExternalName == aliasName);
                    if (oldAlias is null)
                    {
                        db.ProductImportAliases.Add(new ProductImportAlias
                        {
                            ProductCode = aliasCode, ExternalName = aliasName, ProductId = line.ProductId.Value,
                            CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
                        });
                    }
                    else if (oldAlias.ProductId != line.ProductId.Value)
                    {
                        oldAlias.ProductId = line.ProductId.Value;
                        oldAlias.UpdatedBy = current.UserId;
                        oldAlias.UpdatedAt = DateTime.UtcNow;
                    }
                }
            }
            await db.SaveChangesAsync();
        }
        if (transaction is not null) await transaction.CommitAsync();
        return new OrderImportCommitResult(created, overwritten, skipped, failed);
    }

    private async Task<HashSet<int>> LinkedOrderIdsAsync(IEnumerable<int> orderIds)
    {
        var ids = orderIds.Distinct().ToList();
        var delivery = await db.DeliveryNotes.AsNoTracking().Where(x => ids.Contains(x.OrderId))
            .Select(x => x.OrderId).Distinct().ToListAsync();
        var quality = await db.QualityInspections.AsNoTracking().Where(x => ids.Contains(x.OrderId))
            .Select(x => x.OrderId).Distinct().ToListAsync();
        return delivery.Concat(quality).ToHashSet();
    }
}
