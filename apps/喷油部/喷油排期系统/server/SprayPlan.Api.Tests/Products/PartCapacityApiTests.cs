using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

// 验证「新建路径」能录入并存储 dailyCapacity（日产能）
public class PartCapacityApiTests : IAsyncLifetime
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

    // 嵌套建产品时部位带 dailyCapacity → 落库（通过 GET 详情验证）
    [Fact]
    public async Task CreateProduct_WithDailyCapacity_Persists()
    {
        var body = new
        {
            productNo = "CAP001", customerName = "测试客户", specName = "标准",
            items = new[] { new {
                itemName = "兔子", itemOrder = 0, colors = new[] { "粉" },
                parts = new[] { new {
                    partName = "头", partOrder = 0,
                    unitCost = 1.0, laborPrice = 2.0, paintCost = 3.0, quotedPrice = 9.0,
                    dailyCapacity = 5000
                } }
            } }
        };
        var r = await _client.PostAsJsonAsync("/api/products", body);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);

        // POST /api/products 返回 ProductCreated（仅含 id），通过 GET 详情验证 dailyCapacity 是否落库
        var created = await r.Content.ReadFromJsonAsync<JsonElement>();
        var pid = created.GetProperty("id").GetInt32();

        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var dailyCapacity = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("dailyCapacity").GetInt32();
        Assert.Equal(5000, dailyCapacity);
    }

    // POST /api/products/{id}/parts 加部位带 dailyCapacity → 落库（响应体直接含 dailyCapacity）
    [Fact]
    public async Task AddPart_WithDailyCapacity_Persists()
    {
        // 先建一个产品（含 1 子件）
        var createResp = await _client.PostAsJsonAsync("/api/products", new {
            productNo = "CAP002", customerName = "C", specName = "标准",
            items = new[] { new { itemName = "身", itemOrder = 0, colors = new string[0],
                parts = new[] { new { partName = "壳", partOrder = 0,
                    unitCost = 0.0, laborPrice = 0.0, paintCost = 0.0, quotedPrice = 0.0 } } } }
        });
        createResp.EnsureSuccessStatusCode();
        var prod = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var pid = prod.GetProperty("id").GetInt32();

        // 通过 GET 详情获取子件 id
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var itemId = detail.GetProperty("items")[0].GetProperty("id").GetInt32();

        // 给子件加部位，携带 dailyCapacity = 8000
        var r = await _client.PostAsJsonAsync($"/api/products/{pid}/parts", new {
            itemId, partName = "底", partOrder = 1,
            unitCost = 0.0, laborPrice = 0.0, paintCost = 0.0, quotedPrice = 0.0, dailyCapacity = 8000
        });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        // AddPart 返回 PartDto，直接含 dailyCapacity
        Assert.Contains("\"dailyCapacity\":8000", await r.Content.ReadAsStringAsync());
    }
}
