using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Dashboard;

// 仪表盘统计 集成测试。
public class DashboardApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task LoginAsync(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    private async Task<int> CreateProductAsync(string no)
    {
        var r = await _client.PostAsJsonAsync("/api/products", new { productNo = no, customerName = "ZURU" });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task CreateOrderAsync(string no, int pid, string deliveryDate)
        => (await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = no, customerName = "兴信", productId = pid, deliveryDate
        })).EnsureSuccessStatusCode();

    [Fact]
    public async Task Dashboard_Unauthenticated_Returns401()
        => Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/dashboard")).StatusCode);

    [Fact]
    public async Task Dashboard_AsViewer_CanRead()
    {
        await LoginAsync("viewer", "viewer123");
        var r = await _client.GetAsync("/api/dashboard");
        r.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Dashboard_InProductionQuantity_IncludesScheduledAndMatchesOverviewRemainingQty()
    {
        await LoginAsync("clerk", "clerk123");
        await _factory.WithDbAsync(async db => {
            db.Orders.Add(new SprayPlan.Api.Entities.Order {
                ExternalOrderNo = "ACTIVE", Status = "in_production", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 100 } },
                Plans = new() { new() { PartName = "头", GoodQty = 40, LineId = 1, PlanDate = DateTime.UtcNow } }
            });
            db.Orders.Add(new SprayPlan.Api.Entities.Order {
                ExternalOrderNo = "RECEIVED", Status = "received", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 500 } }
            });
            foreach (var status in new[] { "scheduled", "completed", "archived", "draft" })
                db.Orders.Add(new SprayPlan.Api.Entities.Order {
                    ExternalOrderNo = status, Status = status, OrderDate = DateTime.UtcNow,
                    PartQtys = new() { new() { PartName = "头", Qty = 50 }, new() { PartName = "脚", Qty = 50 } }
                });
            await db.SaveChangesAsync();
        });
        var stats = await _client.GetFromJsonAsync<JsonElement>("/api/dashboard");
        Assert.Equal(150, stats.GetProperty("inProductionQty").GetInt32());
        var overview = await _client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        Assert.Contains(overview.EnumerateArray(), o => o.GetProperty("remainingQty").GetInt32() == 100);
    }

    [Fact]
    public async Task Dashboard_QuantityUsesBottleneckAndExcludesPendingInactiveAndOtherFactory()
    {
        await LoginAsync("clerk", "clerk123");
        await _factory.WithDbAsync(async db => {
            foreach (var (status, demand, firstStep, lastStep, secondPart) in new[] {
                ("scheduled", 100, 100, 80, 90), ("in_production", 200, 90, 130, 120)
            }) {
                db.Orders.Add(new SprayPlan.Api.Entities.Order {
                    ExternalOrderNo = "BOTTLENECK-" + status, Status = status, OrderDate = DateTime.UtcNow,
                    PartQtys = new() { new() { PartName = "头", Qty = demand }, new() { PartName = "脚", Qty = demand } },
                    Plans = new() {
                        new() { PartName = "头", StepNo = 1, GoodQty = firstStep, LineId = 1, PlanDate = DateTime.UtcNow },
                        new() { PartName = "头", StepNo = 2, GoodQty = lastStep, LineId = 1, PlanDate = DateTime.UtcNow },
                        new() { PartName = "头", StepNo = 2, GoodQty = 500, LineId = 1, PlanDate = DateTime.UtcNow, DeletedAt = DateTime.UtcNow },
                        new() { PartName = "脚", StepNo = 1, GoodQty = secondPart, LineId = 1, PlanDate = DateTime.UtcNow }
                    }
                });
            }
            foreach (var status in new[] { "received", "completed", "archived" })
                db.Orders.Add(new SprayPlan.Api.Entities.Order {
                    ExternalOrderNo = "EXCLUDED-" + status, Status = status, OrderDate = DateTime.UtcNow,
                    PartQtys = new() { new() { PartName = "头", Qty = 700 } }
                });
            db.Orders.Add(new SprayPlan.Api.Entities.Order {
                ExternalOrderNo = "PENDING", Status = "scheduled", PendingProduct = true, OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 500 } }
            });
            db.Orders.Add(new SprayPlan.Api.Entities.Order {
                ExternalOrderNo = "OTHER-FACTORY", FactoryId = "HUADENG", Status = "scheduled", OrderDate = DateTime.UtcNow,
                PartQtys = new() { new() { PartName = "头", Qty = 987 } }
            });
            await db.SaveChangesAsync();
        });
        var stats = await _client.GetFromJsonAsync<JsonElement>("/api/dashboard");
        Assert.Equal(130, stats.GetProperty("inProductionQty").GetInt32()); // (100 - 80) + (200 - 90)
        var orders = await _client.GetFromJsonAsync<JsonElement>("/api/orders");
        var includedIds = orders.EnumerateArray().Where(o => !o.GetProperty("pendingProduct").GetBoolean() &&
            o.GetProperty("status").GetString() is "scheduled" or "in_production").Select(o => o.GetProperty("id").GetInt32()).ToHashSet();
        var overview = await _client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        Assert.Equal(130, overview.EnumerateArray().Where(o => includedIds.Contains(o.GetProperty("id").GetInt32()))
            .Sum(o => o.GetProperty("remainingQty").GetInt32()));
    }

    [Fact]
    public async Task Dashboard_CountsOrdersProductsAndOverdue()
    {
        await LoginAsync("clerk", "clerk123");
        var p1 = await CreateProductAsync("D1");
        var p2 = await CreateProductAsync("D2");
        await CreateOrderAsync("O-OVERDUE", p1, "2020-01-01");  // 交货日已过 → 逾期
        await CreateOrderAsync("O-FUTURE", p2, "2030-01-01");   // 未来 → 不逾期
        await CreateOrderAsync("O-ARCHIVED", p2, "2020-01-01");
        var orders = await _client.GetFromJsonAsync<JsonElement>("/api/orders");
        var archivedId = orders.EnumerateArray().Single(o => o.GetProperty("externalOrderNo").GetString() == "O-ARCHIVED").GetProperty("id").GetInt32();
        (await _client.DeleteAsync($"/api/orders/{archivedId}")).EnsureSuccessStatusCode();

        var s = await (await _client.GetAsync("/api/dashboard")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, s.GetProperty("ordersTotal").GetInt32()); // 不包含作废单
        Assert.Equal(2, s.GetProperty("productsCount").GetInt32());
        Assert.Equal(1, s.GetProperty("overdue").GetInt32());
        Assert.Equal(0, s.GetProperty("ordersActive").GetInt32());   // 无 confirmed（遗留口径恒 0）
    }
}
