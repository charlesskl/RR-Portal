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
    public async Task Dashboard_CountsOrdersProductsAndOverdue()
    {
        await LoginAsync("clerk", "clerk123");
        var p1 = await CreateProductAsync("D1");
        var p2 = await CreateProductAsync("D2");
        await CreateOrderAsync("O-OVERDUE", p1, "2020-01-01");  // 交货日已过 → 逾期
        await CreateOrderAsync("O-FUTURE", p2, "2030-01-01");   // 未来 → 不逾期

        var s = await (await _client.GetAsync("/api/dashboard")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, s.GetProperty("ordersTotal").GetInt32());
        Assert.Equal(2, s.GetProperty("productsCount").GetInt32());
        Assert.Equal(1, s.GetProperty("overdue").GetInt32());
        Assert.Equal(0, s.GetProperty("ordersActive").GetInt32());   // 无 confirmed（遗留口径恒 0）
    }
}
