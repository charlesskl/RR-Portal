using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

// 订单 集成测试：鉴权 + 嵌套创建 + 状态机 + 校验，对拍现有接口。
public class OrdersApiTests : IAsyncLifetime
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
        var r = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = no, customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task<int> CreateOrderAsync(string orderNo, int productId)
    {
        var r = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = orderNo, productId,
            lines = new[] { new { itemName = "兔子", partQtys = new[] { new { partName = "头", qty = 100 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Get_Unauthenticated_Returns401()
        => Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/orders")).StatusCode);

    [Fact]
    public async Task Create_AsViewer_Forbidden()
    {
        await LoginAsync("viewer", "viewer123");
        var r = await _client.PostAsJsonAsync("/api/orders", new { externalOrderNo = "V1", customerName = "兴信", productId = 1 });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_ListAggregatesTotalQty()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("11494");
        await CreateOrderAsync("ZWZ001", pid);
        var arr = await (await _client.GetAsync("/api/orders")).Content.ReadFromJsonAsync<JsonElement>();
        var first = arr[0];
        Assert.Equal("ZWZ001", first.GetProperty("externalOrderNo").GetString());
        Assert.Equal("11494", first.GetProperty("productNo").GetString());
        Assert.Equal(100, first.GetProperty("totalQty").GetInt32());
        Assert.Equal("received", first.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Create_MissingFields_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/orders", new { externalOrderNo = "X" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_ProductNotExist_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/orders", new { externalOrderNo = "X2", customerName = "兴信", productId = 9999 });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateOrderNo_Returns409()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("P");
        await CreateOrderAsync("DUP", pid);
        var r = await _client.PostAsJsonAsync("/api/orders", new { externalOrderNo = "DUP", customerName = "兴信", productId = pid });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Detail_NotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/orders/9999")).StatusCode);
    }

    [Fact]
    public async Task Detail_IncludesLinesAndProduct()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("D");
        var oid = await CreateOrderAsync("DET", pid);
        var d = await (await _client.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, d.GetProperty("lines").GetArrayLength());
        Assert.Equal("兔子", d.GetProperty("lines")[0].GetProperty("itemName").GetString());
        Assert.Equal("D", d.GetProperty("product").GetProperty("productNo").GetString());
    }

    [Fact]
    public async Task Patch_InvalidStatus_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("PS");
        var oid = await CreateOrderAsync("PS1", pid);
        var r = await _client.PatchAsJsonAsync($"/api/orders/{oid}", new { status = "bogus" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Patch_ManualStatusChange_Rejected()
    {
        // 新规则：状态由系统自动流转，人工不可手动改（仅作废→已接单恢复除外）
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("PSC");
        var oid = await CreateOrderAsync("PSC1", pid);
        var r = await _client.PatchAsJsonAsync($"/api/orders/{oid}", new { status = "scheduled" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Patch_NotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        // 合法状态但订单不存在 → 404
        var r = await _client.PatchAsJsonAsync("/api/orders/9999", new { status = "scheduled" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Delete_ArchivesStatus()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("DEL");
        var oid = await CreateOrderAsync("DEL1", pid);
        var r = await _client.DeleteAsync($"/api/orders/{oid}");
        r.EnsureSuccessStatusCode();
        Assert.Contains("archived", await r.Content.ReadAsStringAsync());
    }
}
