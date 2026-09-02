using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.HqSync;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class HqSyncTests
{
    // —— 状态映射（规范第 7 节）——
    [Theory]
    [InlineData("placed", "已下单")]
    [InlineData("producing", "生产中")]
    [InlineData("delivered", "已交货")]
    [InlineData("cancelled", "已取消")]
    [InlineData("returned", "已退回")]
    [InlineData("voided", "已作废")]
    public void 六种总部状态映射为本地状态(string hqStatus, string expected)
        => Assert.Equal(expected, HqMapping.MapOrderStatus(false, hqStatus));

    [Fact]
    public void 未知状态返回空由调用方保留原值()
        => Assert.Null(HqMapping.MapOrderStatus(false, "some_unknown"));

    [Fact]
    public void is_deleted优先于状态一律作废()
    {
        Assert.Equal("已作废", HqMapping.MapOrderStatus(true, "producing"));
        Assert.Equal("已作废", HqMapping.MapOrderStatus(true, null));
    }

    // —— 工厂 upsert 幂等 ——
    [Fact]
    public async Task 同一加工厂同步两次只保留一条且字段被更新()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        EnqueueFactoryPage(svc, [Factory("f1", "测试车缝厂", phone: "13800000000")], hasMore: false);
        await svc.RunAsync();
        EnqueueFactoryPage(svc, [Factory("f1", "测试车缝厂改名", phone: "13900000000")], hasMore: false);
        await svc.RunAsync();

        await using var db = NewDb(sp);
        var supplier = await db.Suppliers.SingleAsync();
        Assert.Equal("f1", supplier.ExtMainId);
        Assert.Equal("测试车缝厂改名", supplier.SupplierName);
        Assert.Equal("13900000000", supplier.Phone);
        Assert.Equal("HQ-f1", supplier.SupplierCode);   // 已有记录编号不动
    }

    [Fact]
    public async Task is_deleted的加工厂落库为停用()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        EnqueueFactoryPage(svc, [Factory("f1", "厂A") with { IsDeleted = true }], hasMore: false);
        await svc.RunAsync();

        await using var db = NewDb(sp);
        Assert.False((await db.Suppliers.SingleAsync()).IsActive);
    }

    // —— 订单幂等 + 价格映射 ——
    [Fact]
    public async Task 同一总部订单同步两次不产生重复明细行且价格映射正确()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        await SeedFactoryAndProductAsync(sp);
        EnqueueOrderPage(svc, [Order("o1", "PO-1", "f1")], hasMore: false);
        await svc.RunAsync();
        EnqueueOrderPage(svc, [Order("o1", "PO-1", "f1") with { Progress = 80 }], hasMore: false);
        var result = await svc.RunAsync();

        await using var db = NewDb(sp);
        var line = await db.PurchaseOrderLines.SingleAsync();
        Assert.Equal("o1", line.ExtMainId);
        Assert.Equal(1.2124m, line.OutsourcePriceExcl);      // unit_price → 外发价
        Assert.Equal(1.33m, line.InternalPriceExcl);         // quote_labor_price → 核价
        Assert.Null(line.CustomerQuoteExcl);                 // supplier_price 不进任何字段
        Assert.Equal("件", line.Unit);
        var order = await db.PurchaseOrders.SingleAsync();
        Assert.Equal("PO-1", order.OrderNo);
        Assert.Equal("生产中", order.Status);
        Assert.Equal(80, order.ProductionProgress);
        var ordersResult = result!.Resources.Single(r => r.ResourceType == "orders");
        Assert.Equal(1, ordersResult.Updated);
        Assert.Equal(0, ordersResult.Created);
    }

    [Fact]
    public async Task 同订单号不同加工厂生成两个采购订单()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        await SeedFactoryAndProductAsync(sp, "f2");
        EnqueueOrderPage(svc, [
            Order("o1", "PO-SPLIT", "f1"),
            Order("o2", "PO-SPLIT", "f2"),
        ], hasMore: false);
        await svc.RunAsync();

        await using var db = NewDb(sp);
        Assert.Equal(2, await db.PurchaseOrderLines.CountAsync());
        var orders = await db.PurchaseOrders.Where(x => x.OrderNo == "PO-SPLIT").ToListAsync();
        Assert.Equal(2, orders.Count);
        Assert.Equal(2, orders.Select(x => x.SupplierId).Distinct().Count());
    }

    [Fact]
    public async Task 加工厂未同步的订单记失败不落库_货号不存在记跳过()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        await SeedFactoryAndProductAsync(sp);
        EnqueueOrderPage(svc, [
            Order("o-no-factory", "PO-X1", "f-not-exists"),
            Order("o-no-product", "PO-X2", "f1") with { ItemNo = "99999" },
        ], hasMore: false);
        var result = await svc.RunAsync();

        await using var db = NewDb(sp);
        Assert.Equal(0, await db.PurchaseOrderLines.CountAsync());
        var ordersResult = result!.Resources.Single(r => r.ResourceType == "orders");
        Assert.Equal(1, ordersResult.Failed);
        Assert.Equal(1, ordersResult.Skipped);
    }

    // —— 游标推进 ——
    [Fact]
    public async Task 翻页直到has_more为假且游标推进到最后一页()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        svc.FactoryPages.Enqueue(new HqListPage<HqFactoryDto>
        {
            Data = [Factory("f1", "厂A")],
            NextUpdatedAfter = "2026-09-01T08:30:12.123Z", NextCursorId = "factory00000001", HasMore = true,
        });
        svc.FactoryPages.Enqueue(new HqListPage<HqFactoryDto>
        {
            Data = [Factory("f2", "厂B")],
            NextUpdatedAfter = "2026-09-01T09:00:00.000Z", NextCursorId = "factory00000002", HasMore = false,
        });
        await svc.RunAsync();

        await using var db = NewDb(sp);
        Assert.Equal(2, await db.Suppliers.CountAsync());
        var state = await db.IntegrationSyncStates.SingleAsync(x => x.ResourceType == "factories");
        Assert.Equal("2026-09-01T09:00:00.000Z", state.LastCursorUpdatedAt);
        Assert.Equal("factory00000002", state.LastCursorId);
        Assert.NotNull(state.LastSuccessAt);
        // 每资源各一行同步日志
        Assert.Equal(2, await db.IntegrationSyncLogs.CountAsync());
    }

    // —— 防并发 ——
    [Fact]
    public async Task 同步中再次触发直接返回已在运行()
    {
        var (svc, sp) = CreateService();
        await SeedDeptAsync(sp);
        svc.OrdersGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = svc.RunAsync();
        await svc.OrdersEntered.Task;                       // 等第一轮跑到订单拉取
        Assert.Null(await svc.RunAsync());                  // 第二轮：已在运行
        svc.OrdersGate.SetResult();
        Assert.NotNull(await first);
    }

    // —— 测试基础设施 ——

    private static HqFactoryDto Factory(string id, string name, string? phone = null) => new()
    {
        Id = id, Name = name, Craft = "sewing", ContactPhone = phone, Status = "active",
        UpdatedAt = "2026-09-01T08:30:12.123Z",
    };

    private static HqOrderDto Order(string id, string orderNo, string factoryId) => new()
    {
        Id = id, OrderNo = orderNo, FactoryId = factoryId, ItemNo = "15783", Quantity = 10000m,
        Unit = "件", QuoteLaborPrice = 1.33m, SupplierPrice = 9.99m, UnitPrice = 1.2124m,
        OrderDate = "2026-09-01", DeliveryDate = "2026-09-15", Status = "producing",
        Progress = 35, UpdatedAt = "2026-09-01T08:30:12.123Z",
    };

    private static void EnqueueFactoryPage(StubHqSyncService svc, List<HqFactoryDto> data, bool hasMore)
        => svc.FactoryPages.Enqueue(new HqListPage<HqFactoryDto> { Data = data, HasMore = hasMore });

    private static void EnqueueOrderPage(StubHqSyncService svc, List<HqOrderDto> data, bool hasMore)
        => svc.OrderPages.Enqueue(new HqListPage<HqOrderDto> { Data = data, HasMore = hasMore });

    private static async Task SeedDeptAsync(DbContextOptions<AppDbContext> options)
    {
        await using var db = new AppDbContext(options);
        db.Depts.Add(new Dept { DeptCode = "HQ", DeptName = "本厂", IsActive = true, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }

    private static async Task SeedFactoryAndProductAsync(DbContextOptions<AppDbContext> options, params string[] extraFactoryIds)
    {
        await using var db = new AppDbContext(options);
        var deptId = (await db.Depts.FirstAsync()).DeptId;
        foreach (var id in new[] { "f1" }.Concat(extraFactoryIds))
            db.Suppliers.Add(new Supplier
            {
                SupplierCode = "HQ-" + id, SupplierName = "厂" + id, ExtMainId = id,
                DeptId = deptId, IsActive = true, CreatedAt = DateTime.UtcNow,
            });
        db.Products.Add(new Product
        {
            ProductCode = "15783", ProductName = "开心鸡块", DeptId = deptId,
            IsActive = true, CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private static (StubHqSyncService svc, DbContextOptions<AppDbContext> dbOptions) CreateService()
    {
        // 与现有测试同款：DbContext 直接 new，服务通过假 ScopeFactory 每次拿到新实例
        var dbOptions = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var options = Options.Create(new HqSyncOptions { BaseUrl = "http://hq.test", ApiKey = "test-key", PageSize = 2 });
        var svc = new StubHqSyncService(new FakeScopeFactory(dbOptions), options);
        return (svc, dbOptions);
    }

    private static AppDbContext NewDb(DbContextOptions<AppDbContext> options) => new(options);

    /// <summary>每个 scope 解析出一个新的 AppDbContext（共享同一个 InMemory 库）。</summary>
    private sealed class FakeScopeFactory(DbContextOptions<AppDbContext> options) : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => new FakeScope(new AppDbContext(options));

        private sealed class FakeScope(AppDbContext db) : IServiceScope, IAsyncDisposable, IServiceProvider
        {
            public IServiceProvider ServiceProvider => this;
            public object? GetService(Type serviceType) => serviceType == typeof(AppDbContext) ? db : null;
            public void Dispose() => db.Dispose();
            public async ValueTask DisposeAsync() => await db.DisposeAsync();
        }
    }

    /// <summary>用内存队列替代 HttpClient 翻页。</summary>
    private sealed class StubHqSyncService(
        IServiceScopeFactory scopeFactory, IOptions<HqSyncOptions> options)
        : HqSyncService(scopeFactory, options, null!, NullLogger<HqSyncService>.Instance)
    {
        public Queue<HqListPage<HqFactoryDto>> FactoryPages { get; } = new();
        public Queue<HqListPage<HqOrderDto>> OrderPages { get; } = new();
        public TaskCompletionSource OrdersEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource? OrdersGate { get; set; }

        protected override Task<HqListPage<HqFactoryDto>> FetchFactoriesPageAsync(
            string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
            => Task.FromResult(FactoryPages.Count > 0 ? FactoryPages.Dequeue() : new HqListPage<HqFactoryDto>());

        protected override async Task<HqListPage<HqOrderDto>> FetchOrdersPageAsync(
            string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
        {
            OrdersEntered.TrySetResult();
            if (OrdersGate is not null) await OrdersGate.Task;
            return OrderPages.Count > 0 ? OrderPages.Dequeue() : new HqListPage<HqOrderDto>();
        }
    }
}
