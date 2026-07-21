using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

// 产品信息库三层下钻 集成测试：鉴权 + 嵌套创建 + 各种校验 + 级联，对拍现有接口。
public class ProductsApiTests : IAsyncLifetime
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
    {
        var r = await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p });
        r.EnsureSuccessStatusCode();
    }

    // 建一个带 1 子件 1 部位的产品，返回产品 id
    private async Task<int> CreateProductAsync(string productNo, string spec = "标准")
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo,
            customerName = "ZURU",
            specName = spec,
            items = new[] { new { itemName = "兔子", colors = new[] { "粉", "紫" }, parts = new[] { new { partName = "头", unitCost = 1.0, quotedPrice = 5.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var doc = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return doc.GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Get_Unauthenticated_Returns401()
    {
        var r = await _client.GetAsync("/api/products");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_AsViewer_Forbidden()
    {
        await LoginAsync("viewer", "viewer123");
        var r = await _client.PostAsJsonAsync("/api/products", new { productNo = "X1", customerName = "ZURU" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_AsClerk_ListAggregates()
    {
        await LoginAsync("clerk", "clerk123");
        await CreateProductAsync("11494");
        var r = await _client.GetAsync("/api/products");
        r.EnsureSuccessStatusCode();
        var arr = await r.Content.ReadFromJsonAsync<JsonElement>();
        var first = arr[0];
        Assert.Equal("11494", first.GetProperty("productNo").GetString());
        Assert.Equal(1, first.GetProperty("itemCount").GetInt32());
        Assert.Equal(1.0, first.GetProperty("totalUnitCost").GetDouble());
        Assert.Equal(5.0, first.GetProperty("totalQuotedPrice").GetDouble());
    }

    [Fact]
    public async Task List_IncludesUpdatedAtAndLastUpdatedBy()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("11494");
        // 改一次头部，让 lastUpdatedBy 落上 clerk（新建时该字段为空，符合"还没人改过"语义）
        var patch = await _client.PatchAsJsonAsync($"/api/products/{pid}", new { remark = "改一下" });
        patch.EnsureSuccessStatusCode();
        var r = await _client.GetAsync("/api/products");
        r.EnsureSuccessStatusCode();
        var arr = await r.Content.ReadFromJsonAsync<JsonElement>();
        var first = arr[0];
        // 列表必须带出修改人和修改时间（前端"修改日期/修改人"列要用）
        Assert.Equal("clerk", first.GetProperty("lastUpdatedBy").GetString());
        Assert.True(first.TryGetProperty("updatedAt", out var ua));
        Assert.NotEqual(JsonValueKind.Null, ua.ValueKind);
    }

    [Fact]
    public async Task Create_MissingFields_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/products", new { remark = "缺货号" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_PartWithoutName_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "P2", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "" } } } }
        });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateNoSpec_Returns409()
    {
        await LoginAsync("clerk", "clerk123");
        await CreateProductAsync("DUP");
        var r = await _client.PostAsJsonAsync("/api/products", new { productNo = "DUP", customerName = "ZURU", specName = "标准" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Detail_NotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.GetAsync("/api/products/9999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Patch_InvalidStatus_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("PS");
        var r = await _client.PatchAsJsonAsync($"/api/products/{pid}", new { status = "bogus" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Delete_ArchivesStatus()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("DEL");
        var r = await _client.DeleteAsync($"/api/products/{pid}");
        r.EnsureSuccessStatusCode();
        Assert.Contains("archived", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AddItem_ThenAddPart_Flow()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("FLOW");

        // 加子件
        var itemResp = await _client.PostAsJsonAsync($"/api/products/{pid}/items", new { itemName = "青蛙", colors = new[] { "蓝" } });
        Assert.Equal(HttpStatusCode.Created, itemResp.StatusCode);
        var itemId = (await itemResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // 给该子件加部位
        var partResp = await _client.PostAsJsonAsync($"/api/products/{pid}/parts", new { itemId, partName = "腿", unitCost = 2.0 });
        Assert.Equal(HttpStatusCode.Created, partResp.StatusCode);
    }

    [Fact]
    public async Task AddPart_WrongProduct_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("WP");
        // itemId=9999 不属于该产品 → 404
        var r = await _client.PostAsJsonAsync($"/api/products/{pid}/parts", new { itemId = 9999, partName = "腿" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task PatchPart_InvalidMode_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("PM");
        // 取详情拿第一个部位 id
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var partId = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("id").GetInt32();

        var r = await _client.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}", new { productionMode = "bogus" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task DeleteItem_CascadesParts()
    {
        await LoginAsync("clerk", "clerk123");
        var pid = await CreateProductAsync("CAS");
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var itemId = detail.GetProperty("items")[0].GetProperty("id").GetInt32();

        // 删子件应级联删其部位
        var del = await _client.DeleteAsync($"/api/products/{pid}/items/{itemId}");
        del.EnsureSuccessStatusCode();

        // 再取详情，items 应为空
        var after = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, after.GetProperty("items").GetArrayLength());
    }
}
