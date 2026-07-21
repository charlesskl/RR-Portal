using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

// 部位「工序/工艺」字段：存取、非法值拦截。
public class ProductCraftTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    [Fact]
    public async Task Create_WithPartCraft_PersistsAndReturns()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "C1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", craft = "移印", unitCost = 1.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var pid = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{pid}");
        var craft = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("craft").GetString();
        Assert.Equal("移印", craft);
    }

    [Fact]
    public async Task AddPart_InvalidCraft_Returns400()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "C2", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var pid = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{pid}");
        var itemId = detail.GetProperty("items")[0].GetProperty("id").GetInt32();
        // 非法工艺「喷漆」应被拦
        var add = await _client.PostAsJsonAsync($"/api/products/{pid}/parts", new { itemId, partName = "脚", craft = "喷漆" });
        Assert.Equal(HttpStatusCode.BadRequest, add.StatusCode);
    }

    [Fact]
    public async Task UpdatePart_Craft_Succeeds()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "C3", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", craft = "移印", unitCost = 1.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var pid = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{pid}");
        var partId = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("id").GetInt32();
        var patch = await _client.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}", new { craft = "UV" });
        patch.EnsureSuccessStatusCode();
        Assert.Contains("UV", await patch.Content.ReadAsStringAsync());
    }
}
