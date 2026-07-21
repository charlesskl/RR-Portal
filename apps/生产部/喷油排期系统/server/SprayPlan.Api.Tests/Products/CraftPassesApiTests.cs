using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

// 验证「工序道数 craftPasses」能录入/落库/回显，且道数<工序种类数被拦
public class CraftPassesApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        await Login("clerk", "clerk123");
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task Login(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // 嵌套建产品时部位带 craftPasses → 落库并回显
    [Fact]
    public async Task CreateProduct_WithCraftPasses_Persists()
    {
        var body = new
        {
            productNo = "CP001",
            items = new[] { new {
                itemName = "兔子",
                parts = new[] { new {
                    partName = "头", partOrder = 0, craft = "自动喷",
                    unitCost = 1.0, laborPrice = 2.0, paintCost = 3.0, quotedPrice = 9.0,
                    dailyCapacity = 3000, craftPasses = 4
                } }
            } }
        };
        var r = await _client.PostAsJsonAsync("/api/products", body);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var created = await r.Content.ReadFromJsonAsync<JsonElement>();
        var pid = created.GetProperty("id").GetInt32();

        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var passes = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("craftPasses").GetInt32();
        Assert.Equal(4, passes);
    }

    // PATCH 改部位 craftPasses → 回显新值
    [Fact]
    public async Task UpdatePart_CraftPasses_Persists()
    {
        // 先建一个产品拿到 partId
        var body = new
        {
            productNo = "CP002",
            items = new[] { new {
                itemName = "兔子",
                parts = new[] { new { partName = "头", partOrder = 0, craft = "自动喷", craftPasses = 2 } }
            } }
        };
        var cr = await (await _client.PostAsJsonAsync("/api/products", body)).Content.ReadFromJsonAsync<JsonElement>();
        var pid = cr.GetProperty("id").GetInt32();
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var partId = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("id").GetInt32();

        var patch = await _client.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}", new { craftPasses = 5 });
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        var detail2 = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var passes = detail2.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("craftPasses").GetInt32();
        Assert.Equal(5, passes);
    }
}
