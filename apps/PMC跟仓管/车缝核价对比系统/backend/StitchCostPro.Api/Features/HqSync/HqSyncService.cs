using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.HqSync;

public record HqSyncResourceResult(string ResourceType, string Status, int Received, int Created,
    int Updated, int Skipped, int Failed, string? ErrorMessage, DateTime StartedAt, DateTime? FinishedAt);

public record HqSyncRunResult(DateTime StartedAt, List<HqSyncResourceResult> Resources, string? Message);

/// <summary>
/// 总部集成同步：从总部加工厂系统只读 API 增量拉取加工厂和订单，幂等落入本地库。
/// 规则依据《总部加工厂系统对车缝核价对比系统 API 接口规范 V1.0》：
/// 先 factories 后 orders；按 (updated_at, id) 游标翻页；整页一次 SaveChanges 落库成功后才推进游标。
/// </summary>
public class HqSyncService
{
    private const string Source = "hq";                 // 同步来源标识
    private const string ResourceFactories = "factories";
    private const string ResourceOrders = "orders";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly HqSyncOptions _options;
    private readonly HqApiClient _client;
    private readonly ILogger<HqSyncService> _logger;

    // 定时任务与手动触发共用同一把锁，同一时间不并发执行同步（规范第 2 节）。
    private readonly SemaphoreSlim _gate = new(1, 1);

    public HqSyncService(IServiceScopeFactory scopeFactory, IOptions<HqSyncOptions> options,
        HqApiClient client, ILogger<HqSyncService> logger)
    {
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _client = client;
        _logger = logger;
    }

    // —— 单页拉取抽成虚方法，测试可替换为内存 stub ——
    protected virtual Task<HqListPage<HqFactoryDto>> FetchFactoriesPageAsync(string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
        => _client.GetFactoriesAsync(updatedAfter, cursorId, pageSize, ct);

    protected virtual Task<HqListPage<HqOrderDto>> FetchOrdersPageAsync(string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
        => _client.GetOrdersAsync(updatedAfter, cursorId, pageSize, ct);

    /// <summary>跑一整轮（先加工厂后订单）。已有同步在运行时返回 null。</summary>
    public async Task<HqSyncRunResult?> RunAsync(CancellationToken ct = default)
    {
        if (!await _gate.WaitAsync(0, ct)) return null;
        try
        {
            var startedAt = DateTime.UtcNow;
            if (string.IsNullOrWhiteSpace(_options.BaseUrl) || string.IsNullOrWhiteSpace(_options.ApiKey))
                return new HqSyncRunResult(startedAt, [], "HqSync 未配置 BaseUrl/ApiKey，本轮未执行");

            // 单例服务不直接持有 DbContext，每轮新建 scope 取用。
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var resources = new List<HqSyncResourceResult>
            {
                await SyncFactoriesAsync(db, ct),
                await SyncOrdersAsync(db, ct),
            };
            return new HqSyncRunResult(startedAt, resources, null);
        }
        finally
        {
            _gate.Release();
        }
    }

    // —— 加工厂：按 Supplier.ExtMainId 幂等 upsert ——
    private async Task<HqSyncResourceResult> SyncFactoriesAsync(AppDbContext db, CancellationToken ct)
    {
        var log = new IntegrationSyncLog { ResourceType = ResourceFactories, StartedAt = DateTime.UtcNow, Status = "success" };
        try
        {
            var defaultDeptId = await GetDefaultDeptIdAsync(db, ct);
            var state = await GetStateAsync(db, ResourceFactories, ct);
            string? updatedAfter = state.LastCursorUpdatedAt, cursorId = state.LastCursorId;
            bool hasMore;
            do
            {
                var page = await FetchFactoriesPageAsync(updatedAfter, cursorId, _options.PageSize, ct);
                var extIds = page.Data.Where(x => !string.IsNullOrWhiteSpace(x.Id))
                    .Select(x => x.Id).Distinct().ToList();
                var existing = await db.Suppliers
                    .Where(x => x.ExtMainId != null && extIds.Contains(x.ExtMainId))
                    .ToDictionaryAsync(x => x.ExtMainId!, ct);

                foreach (var f in page.Data)
                {
                    log.ReceivedCount++;
                    if (string.IsNullOrWhiteSpace(f.Id)) { log.FailedCount++; continue; }   // 防御：无幂等键
                    if (existing.TryGetValue(f.Id, out var supplier))
                    {
                        supplier.UpdatedAt = DateTime.UtcNow;
                        log.UpdatedCount++;
                    }
                    else
                    {
                        supplier = new Supplier
                        {
                            SupplierCode = NewSupplierCode(f.Id),
                            SupplierName = NewSupplierCode(f.Id),   // ApplyFactory 里用总部名称覆盖，兜底防 NOT NULL
                            ExtMainId = f.Id,
                            DeptId = defaultDeptId,
                            IsActive = true,
                            CreatedAt = DateTime.UtcNow,
                        };
                        db.Suppliers.Add(supplier);
                        existing[f.Id] = supplier;
                        log.CreatedCount++;
                    }
                    ApplyFactory(supplier, f);
                }

                // 整页数据 + 游标一次 SaveChanges（关系库下即一个事务），失败则游标保持不动、下轮重拉本页。
                AdvanceCursor(state, page);
                await db.SaveChangesAsync(ct);
                updatedAfter = page.NextUpdatedAfter;
                cursorId = page.NextCursorId;
                hasMore = page.HasMore;
            } while (hasMore);

            state.LastSuccessAt = DateTime.UtcNow;
            state.LastError = null;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.Status = "failed";
            log.ErrorMessage = ex.Message;
            _logger.LogError(ex, "总部加工厂同步失败");
            await RecordFailureAsync(ResourceFactories, ex.Message, ct);
        }
        log.FinishedAt = DateTime.UtcNow;
        await WriteLogAsync(log, ct);
        return ToResult(log);
    }

    // —— 订单：每条总部记录 = 一条采购订单明细行（ExtMainId=总部 id 幂等 upsert）——
    private async Task<HqSyncResourceResult> SyncOrdersAsync(AppDbContext db, CancellationToken ct)
    {
        var log = new IntegrationSyncLog { ResourceType = ResourceOrders, StartedAt = DateTime.UtcNow, Status = "success" };
        try
        {
            var defaultDeptId = await GetDefaultDeptIdAsync(db, ct);
            var state = await GetStateAsync(db, ResourceOrders, ct);
            // 总部已同步的加工厂映射（factory_id → 本地 supplier_id）
            var supplierMap = await db.Suppliers.Where(x => x.ExtMainId != null)
                .ToDictionaryAsync(x => x.ExtMainId!, x => x.SupplierId, ct);
            string? updatedAfter = state.LastCursorUpdatedAt, cursorId = state.LastCursorId;
            bool hasMore;
            do
            {
                var page = await FetchOrdersPageAsync(updatedAfter, cursorId, _options.PageSize, ct);
                var orderIds = page.Data.Where(x => !string.IsNullOrWhiteSpace(x.Id))
                    .Select(x => x.Id).Distinct().ToList();
                var lineMap = await db.PurchaseOrderLines
                    .Where(x => x.ExtMainId != null && orderIds.Contains(x.ExtMainId))
                    .ToDictionaryAsync(x => x.ExtMainId!, ct);
                var orderNos = page.Data.Where(x => !string.IsNullOrWhiteSpace(x.OrderNo))
                    .Select(x => x.OrderNo).Distinct().ToList();
                var headerMap = (await db.PurchaseOrders.Where(x => orderNos.Contains(x.OrderNo)).ToListAsync(ct))
                    .GroupBy(x => (x.OrderNo, x.SupplierId)).ToDictionary(g => g.Key, g => g.First());
                // purchase_order_line.product_id NOT NULL：只能按货号匹配已有产品，不新建
                var itemNos = page.Data.Select(x => (x.ItemNo ?? "").Trim())
                    .Where(x => x.Length > 0).Distinct().ToList();
                var productMap = (await db.Products.Where(x => itemNos.Contains(x.ProductCode)).ToListAsync(ct))
                    .GroupBy(x => x.ProductCode).ToDictionary(g => g.Key, g => g.First().ProductId);

                foreach (var o in page.Data)
                {
                    log.ReceivedCount++;
                    if (string.IsNullOrWhiteSpace(o.Id) || string.IsNullOrWhiteSpace(o.OrderNo))
                    {
                        log.FailedCount++;
                        continue;
                    }
                    // 加工厂未同步 → 该条记 failed 不落库，不影响其它行（规范第 10 节）
                    if (o.FactoryId is null || !supplierMap.TryGetValue(o.FactoryId, out var supplierId))
                    {
                        log.FailedCount++;
                        _logger.LogWarning("总部订单 {OrderId} 的加工厂 {FactoryId} 尚未同步，本条不落库", o.Id, o.FactoryId);
                        continue;
                    }
                    // 货号在本地产品档案找不到 → 记 skipped 跳过（第一阶段不自动建产品）
                    var itemNo = (o.ItemNo ?? "").Trim();
                    if (itemNo.Length == 0 || !productMap.TryGetValue(itemNo, out var productId))
                    {
                        log.SkippedCount++;
                        _logger.LogWarning("总部订单 {OrderId} 货号 {ItemNo} 在本地产品档案不存在，本条跳过", o.Id, o.ItemNo);
                        continue;
                    }

                    if (lineMap.TryGetValue(o.Id, out var line))
                    {
                        log.UpdatedCount++;
                    }
                    else
                    {
                        var header = GetOrCreateHeader(db, headerMap, o, supplierId, defaultDeptId);
                        line = new PurchaseOrderLine
                        {
                            ExtMainId = o.Id,
                            Order = header,   // 新订单头 OrderId 未生成，走导航让 EF 保存时回填
                            ProductId = productId,
                        };
                        db.PurchaseOrderLines.Add(line);
                        lineMap[o.Id] = line;
                        log.CreatedCount++;
                    }
                    ApplyOrderLine(line, o);
                    if (line.Order is not null)
                        ApplyOrderHeader(line.Order, o);
                    else if (headerMap.TryGetValue((o.OrderNo, supplierId), out var trackedHeader))
                        ApplyOrderHeader(trackedHeader, o);
                }

                AdvanceCursor(state, page);
                await db.SaveChangesAsync(ct);
                updatedAfter = page.NextUpdatedAfter;
                cursorId = page.NextCursorId;
                hasMore = page.HasMore;
            } while (hasMore);

            state.LastSuccessAt = DateTime.UtcNow;
            state.LastError = null;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.Status = "failed";
            log.ErrorMessage = ex.Message;
            _logger.LogError(ex, "总部订单同步失败");
            await RecordFailureAsync(ResourceOrders, ex.Message, ct);
        }
        log.FinishedAt = DateTime.UtcNow;
        await WriteLogAsync(log, ct);
        return ToResult(log);
    }

    /// <summary>订单头按 (order_no, supplier_id) 查找，不存在则新建（总部同一订单号可拆分给不同加工厂）。</summary>
    private PurchaseOrder GetOrCreateHeader(AppDbContext db,
        Dictionary<(string OrderNo, int SupplierId), PurchaseOrder> headerMap,
        HqOrderDto o, int supplierId, int deptId)
    {
        if (headerMap.TryGetValue((o.OrderNo, supplierId), out var header))
            return header;
        // headerMap 已预载本页全部 order_no，查不到即新单；ExtMainId 记首个落入本订单头的总部记录 id（溯源用）
        header = new PurchaseOrder
        {
            OrderNo = o.OrderNo,
            SupplierId = supplierId,
            DeptId = deptId,
            OrderDate = HqMapping.ParseDate(o.OrderDate) ?? DateOnly.FromDateTime(DateTime.UtcNow),  // 总部 order_date 可空，兜底当天
            Status = "已下单",
            ExtMainId = o.Id,
            CreatedAt = DateTime.UtcNow,
        };
        db.PurchaseOrders.Add(header);
        headerMap[(o.OrderNo, supplierId)] = header;
        return header;
    }

    /// <summary>总部加工厂字段 → Supplier。is_deleted=true 的厂停用（IsActive=false），不做物理删除。</summary>
    private static void ApplyFactory(Supplier supplier, HqFactoryDto f)
    {
        var name = (f.Name ?? "").Trim();
        if (name.Length > 0) supplier.SupplierName = name;
        supplier.Contact = NullIfEmpty(f.ContactPerson);
        supplier.Phone = NullIfEmpty(f.ContactPhone);
        supplier.Address = NullIfEmpty(f.Address);
        supplier.Location = NullIfEmpty(f.Region);
        supplier.EquipmentCount = f.EquipmentQty;
        supplier.EmployeeCount = f.StaffCount;
        supplier.MonthlyCapacity = HqMapping.CapacityToString(f.MonthlyCapacity);
        supplier.Qualification = NullIfEmpty(f.CertStatus);
        supplier.MainProcess = NullIfEmpty(f.Craft);
        supplier.IsActive = !f.IsDeleted && f.Status == "active";
    }

    /// <summary>总部订单字段 → 明细行。supplier_price 为总部历史参考字段，第一阶段不映射到任何价格字段。</summary>
    private static void ApplyOrderLine(PurchaseOrderLine line, HqOrderDto o)
    {
        line.Qty = o.Quantity;
        line.Unit = string.IsNullOrWhiteSpace(o.Unit) ? "件" : o.Unit.Trim();
        line.OutsourcePriceExcl = o.UnitPrice;        // unit_price → 外发工价(不含税)
        line.InternalPriceExcl = o.QuoteLaborPrice;   // quote_labor_price → 核价工价(不含税)
        line.SourceUpdatedAt = HqMapping.ParseUtc(o.UpdatedAt);
    }

    /// <summary>总部订单字段 → 订单头快照（同一张单多条记录时最后一条生效）。</summary>
    private void ApplyOrderHeader(PurchaseOrder header, HqOrderDto o)
    {
        if (HqMapping.ParseDate(o.OrderDate) is { } orderDate)
            header.OrderDate = orderDate;
        header.DeliveryDate = HqMapping.ParseDate(o.DeliveryDate);
        var status = HqMapping.MapOrderStatus(o.IsDeleted, o.Status);
        if (status is not null)
            header.Status = status;
        else
            _logger.LogWarning("总部订单 {OrderId} 状态 {Status} 未知，保留本地状态 {LocalStatus}", o.Id, o.Status, header.Status);
        header.ProductionProgress = o.Progress;
        header.DelayDays = o.DelayDays;
        header.DelayReason = NullIfEmpty(o.DelayReason);
        header.Remark = NullIfEmpty(o.Notes);
        header.SourceUpdatedAt = HqMapping.ParseUtc(o.UpdatedAt);
        header.UpdatedAt = DateTime.UtcNow;
    }

    private async Task<IntegrationSyncState> GetStateAsync(AppDbContext db, string resourceType, CancellationToken ct)
    {
        var state = await db.IntegrationSyncStates
            .FirstOrDefaultAsync(x => x.Source == Source && x.ResourceType == resourceType, ct);
        if (state is null)
        {
            state = new IntegrationSyncState { Source = Source, ResourceType = resourceType, UpdatedAt = DateTime.UtcNow };
            db.IntegrationSyncStates.Add(state);
        }
        return state;
    }

    private static void AdvanceCursor<T>(IntegrationSyncState state, HqListPage<T> page)
    {
        // 游标原样保存、原样回传（规范第 3 节）；只有整页落库成功后才走到这里。
        state.LastCursorUpdatedAt = page.NextUpdatedAfter;
        state.LastCursorId = page.NextCursorId;
        state.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// 总部没有部门概念：默认部门取配置的 HqSync:DefaultDeptId（>0），
    /// 否则取本厂 HQ 部门，再没有则取系统第一个部门；一个部门都没有时直接失败（dept_id NOT NULL）。
    /// </summary>
    private async Task<int> GetDefaultDeptIdAsync(AppDbContext db, CancellationToken ct)
    {
        if (_options.DefaultDeptId > 0) return _options.DefaultDeptId;
        var dept = await db.Depts.Where(x => x.DeptCode == "HQ").OrderBy(x => x.DeptId).FirstOrDefaultAsync(ct)
            ?? await db.Depts.OrderBy(x => x.DeptId).FirstOrDefaultAsync(ct);
        return dept?.DeptId
            ?? throw new InvalidOperationException("系统尚无部门且未配置 HqSync:DefaultDeptId，无法落库同步数据");
    }

    /// <summary>同步失败时用全新 scope 把错误写回游标表（原 scope 可能带着失败页残留）。</summary>
    private async Task RecordFailureAsync(string resourceType, string error, CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var state = await GetStateAsync(db, resourceType, ct);
            state.LastError = error.Length > 1000 ? error[..1000] : error;
            state.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "回写同步失败状态失败");
        }
    }

    /// <summary>同步日志独立 scope 写入，失败不反过来影响同步结果。</summary>
    private async Task WriteLogAsync(IntegrationSyncLog log, CancellationToken ct)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.IntegrationSyncLogs.Add(log);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入同步日志失败");
        }
    }

    private static HqSyncResourceResult ToResult(IntegrationSyncLog log) => new(
        log.ResourceType, log.Status, log.ReceivedCount, log.CreatedCount, log.UpdatedCount,
        log.SkippedCount, log.FailedCount, log.ErrorMessage, log.StartedAt, log.FinishedAt);

    private static string NewSupplierCode(string extId) => ("HQ-" + extId)[..Math.Min(50, extId.Length + 3)];

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
