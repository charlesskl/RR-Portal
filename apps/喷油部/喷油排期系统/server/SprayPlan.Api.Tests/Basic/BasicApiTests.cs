using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

// 基础数据库（拉别/机台）集成测试：鉴权三态 + 各种校验，对拍现有 Next 接口行为。
public class BasicApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();        // 种 admin/clerk/viewer + 胡旗拉(id=1) + 机台5#
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task LoginAsync(string u, string p)
    {
        var r = await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p });
        r.EnsureSuccessStatusCode();
    }

    // ---------- 拉别 ----------
    [Fact]
    public async Task Lines_Unauthenticated_Returns401()
    {
        var r = await _client.GetAsync("/api/lines");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Lines_AsViewer_CanRead()
    {
        await LoginAsync("viewer", "viewer123");    // 只读角色也能读
        var r = await _client.GetAsync("/api/lines");
        r.EnsureSuccessStatusCode();
        Assert.Contains("胡旗拉", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Lines_Create_AsViewer_Forbidden()
    {
        await LoginAsync("viewer", "viewer123");    // 只读不能写
        var r = await _client.PostAsJsonAsync("/api/lines", new { name = "X拉", workshop = "华登A" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Lines_Create_AsClerk_Returns201()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/lines", new { name = "宋沛霖拉", workshop = "华登A" });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
    }

    [Fact]
    public async Task Lines_Create_MissingFields_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/lines", new { name = "缺车间" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Lines_Delete_SoftDeactivates()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.DeleteAsync("/api/lines/1");
        r.EnsureSuccessStatusCode();
        Assert.Contains("\"isActive\":false", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Lines_Patch_NotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PatchAsJsonAsync("/api/lines/9999", new { name = "改" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---------- 机台 ----------
    [Fact]
    public async Task Machines_List_IncludesLineInfo()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.GetAsync("/api/machines");
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadAsStringAsync();
        Assert.Contains("5#", body);
        Assert.Contains("胡旗拉", body);   // 含所属拉别名
    }

    [Fact]
    public async Task Machines_Create_DuplicateNo_Returns409()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/machines", new { machineNo = "5#", lineId = 1 });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Machines_Create_InvalidLine_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/machines", new { machineNo = "99#", lineId = 9999 });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Machines_Create_AsClerk_Returns201()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/machines", new { machineNo = "21#", lineId = 1, isUV = false });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
    }
}
