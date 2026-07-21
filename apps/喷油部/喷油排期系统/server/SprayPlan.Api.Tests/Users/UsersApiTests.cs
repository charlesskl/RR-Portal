using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Users;

// 用户管理集成测试：覆盖鉴权三态（未登录/越权/主管）+ CRUD 全场景。
// 每个测试独立一个 ApiFactory（独立临时库），互不干扰。
public class UsersApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();          // 默认带 CookieContainer，登录后自动保持 Cookie
        await _factory.SeedAsync();
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task LoginAsync(string username, string password)
    {
        var resp = await _client.PostAsJsonAsync("/api/auth/login", new { username, password });
        resp.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task List_Unauthenticated_Returns401()
    {
        var resp = await _client.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task List_AsClerk_Returns403()
    {
        await LoginAsync("clerk", "clerk123");
        var resp = await _client.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task List_AsAdmin_ReturnsSeededUsers()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.GetAsync("/api/users");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("admin", body);
        Assert.Contains("clerk", body);
        Assert.DoesNotContain("passwordHash", body);   // 绝不泄露哈希
    }

    [Fact]
    public async Task Create_AsAdmin_Returns201()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.PostAsJsonAsync("/api/users",
            new { username = "newbie", password = "pass123", displayName = "新人", role = "viewer" });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    [Fact]
    public async Task Create_DuplicateUsername_Returns409()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.PostAsJsonAsync("/api/users",
            new { username = "clerk", password = "x12345", displayName = "重复", role = "clerk" });
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Create_InvalidRole_Returns400()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.PostAsJsonAsync("/api/users",
            new { username = "badrole", password = "x12345", displayName = "坏角色", role = "boss" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Create_MissingFields_Returns400()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.PostAsJsonAsync("/api/users",
            new { username = "nopass", password = "", displayName = "缺密码", role = "viewer" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Delete_Self_Returns400()
    {
        await LoginAsync("admin", "admin123");      // admin 是种子第一个，id=1
        var resp = await _client.DeleteAsync("/api/users/1");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Update_DisplayName_Works()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.PatchAsJsonAsync("/api/users/2", new { displayName = "改名文员" });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadAsStringAsync();
        Assert.Contains("改名文员", body);
    }

    [Fact]
    public async Task Get_NotFound_Returns404()
    {
        await LoginAsync("admin", "admin123");
        var resp = await _client.GetAsync("/api/users/9999");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
