using System.Linq;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

// 拉别每天产能上限 DailyCapacityLimit 的读写（工序链 P2 Task 1）
// 仿 BasicApiTests：每用例 new ApiFactory + SeedAsync（种 admin/clerk/viewer），cookie 随 HttpClient 自动带。
public class LineCapacityTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _c = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _c = _factory.CreateClient();
        await _factory.SeedAsync();
    }
    public Task DisposeAsync() { _c.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task LoginAsync(string u, string p)
    {
        var r = await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p });
        r.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task CreateAndPatch_PersistsDailyCapacityLimit()
    {
        await LoginAsync("clerk", "clerk123");

        // 新建拉别带上限 300000（件）
        var create = await _c.PostAsJsonAsync("/api/lines", new
        {
            name = "测试拉：移印", workshop = "兴信A", craftType = "移印", dailyCapacityLimit = 300000
        });
        create.EnsureSuccessStatusCode();
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        // GET 列表能读到该上限
        var list = await (await _c.GetAsync("/api/lines")).Content.ReadFromJsonAsync<JsonElement>();
        var mine = list.EnumerateArray().First(l => l.GetProperty("id").GetInt32() == id);
        Assert.Equal(300000, mine.GetProperty("dailyCapacityLimit").GetInt32());

        // PATCH 改成 250000
        var patch = await _c.PatchAsJsonAsync($"/api/lines/{id}", new { dailyCapacityLimit = 250000 });
        patch.EnsureSuccessStatusCode();
        var after = await (await _c.GetAsync($"/api/lines/{id}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(250000, after.GetProperty("dailyCapacityLimit").GetInt32());
    }
}
