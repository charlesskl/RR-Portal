using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Products;

// 产品审核门禁：置为「已生效」(active) 只有管理员能做，文员不能自审。
public class ProductApprovalTests : IAsyncLifetime
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

    private async Task Login(string u, string p) =>
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    private async Task<int> CreateDraft()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "AP1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Approve_AsClerk_Forbidden()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateDraft();
        var r = await _client.PatchAsJsonAsync($"/api/products/{pid}", new { status = "active" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);   // 文员不能自审生效
    }

    [Fact]
    public async Task Approve_AsAdmin_Succeeds()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateDraft();                          // 文员录入=待审核 draft
        await Login("admin", "admin123");                       // 切管理员
        var r = await _client.PatchAsJsonAsync($"/api/products/{pid}", new { status = "active" });
        r.EnsureSuccessStatusCode();
        var get = await _client.GetFromJsonAsync<JsonElement>($"/api/products/{pid}");
        Assert.Equal("active", get.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Clerk_CanStillArchiveAndReturnToDraft()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateDraft();
        // 文员可作废（DELETE）
        (await _client.DeleteAsync($"/api/products/{pid}")).EnsureSuccessStatusCode();
        // 文员可把作废的恢复到待审核（draft），但不能直接置 active
        var restore = await _client.PatchAsJsonAsync($"/api/products/{pid}", new { status = "draft" });
        restore.EnsureSuccessStatusCode();
    }
}
