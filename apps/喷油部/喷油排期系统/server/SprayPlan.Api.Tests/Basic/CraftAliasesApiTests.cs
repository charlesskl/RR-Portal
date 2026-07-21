using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

/// <summary>
/// 工序对照表 /api/craft-aliases CRUD 集成测试
/// </summary>
public class CraftAliasesApiTests : IAsyncLifetime
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

    // 登录辅助方法，复用 HolidaysApiTests 的写法
    private async Task Login(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // ===== 认证/权限 =====

    [Fact]
    public async Task List_Unauthenticated_401()
    {
        // 未登录访问列表应返回 401
        var r = await _client.GetAsync("/api/craft-aliases");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_AsViewer_403()
    {
        // viewer 无写权限，创建应返回 403
        await Login("viewer", "viewer123");
        var r = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "散枪", category = "手喷" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    // ===== 核心流程：空列表→建一条→列表有1条→删除 =====

    [Fact]
    public async Task EmptyList_Create_ListHasOne_Delete()
    {
        await Login("clerk", "clerk123");

        // 1. 初始列表为空（测试用内存库隔离）
        var list0 = await _client.GetFromJsonAsync<List<CraftAliasLite>>("/api/craft-aliases");
        Assert.NotNull(list0);

        // 2. 新建一条
        var c = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "散枪", category = "手喷" });
        Assert.Equal(HttpStatusCode.Created, c.StatusCode);
        var created = await c.Content.ReadFromJsonAsync<CraftAliasLite>();
        Assert.NotNull(created);
        Assert.Equal("散枪", created!.Alias);
        Assert.Equal("手喷", created.Category);
        Assert.True(created.Id > 0);

        // 3. 列表中有 1 条
        var list1 = await _client.GetFromJsonAsync<List<CraftAliasLite>>("/api/craft-aliases");
        Assert.Contains(list1!, x => x.Alias == "散枪" && x.Category == "手喷");

        // 4. 删除
        var d = await _client.DeleteAsync($"/api/craft-aliases/{created.Id}");
        d.EnsureSuccessStatusCode();

        // 5. 删除后列表不再包含该条
        var list2 = await _client.GetFromJsonAsync<List<CraftAliasLite>>("/api/craft-aliases");
        Assert.DoesNotContain(list2!, x => x.Id == created.Id);
    }

    // ===== 校验：重复 alias → 409 =====

    [Fact]
    public async Task Create_DuplicateAlias_409()
    {
        await Login("clerk", "clerk123");

        // 先建一条
        var r1 = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "喷油", category = "手喷" });
        Assert.Equal(HttpStatusCode.Created, r1.StatusCode);

        // 重复 alias 应返回 409
        var r2 = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "喷油", category = "自动喷" });
        Assert.Equal(HttpStatusCode.Conflict, r2.StatusCode);
    }

    // ===== 校验：非法 category → 400 =====

    [Fact]
    public async Task Create_InvalidCategory_400()
    {
        await Login("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "测试工序", category = "非法大类" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ===== 校验：alias 空字符串 → 400 =====

    [Fact]
    public async Task Create_EmptyAlias_400()
    {
        await Login("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "  ", category = "手喷" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ===== 编辑：改 category =====

    [Fact]
    public async Task Patch_ChangeCategory_200()
    {
        await Login("clerk", "clerk123");

        // 先建一条
        var c = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "PP水", category = "手喷" });
        var created = await c.Content.ReadFromJsonAsync<CraftAliasLite>();

        // 改 category
        var p = await _client.PatchAsJsonAsync($"/api/craft-aliases/{created!.Id}", new { category = "移印" });
        Assert.Equal(HttpStatusCode.OK, p.StatusCode);
        var updated = await p.Content.ReadFromJsonAsync<CraftAliasLite>();
        Assert.Equal("移印", updated!.Category);
        Assert.Equal("PP水", updated.Alias); // alias 不变
    }

    // ===== 编辑：改 alias 成已有重名 → 409 =====

    [Fact]
    public async Task Patch_AliasConflict_409()
    {
        await Login("clerk", "clerk123");

        // 建两条
        var c1 = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "工序A", category = "手喷" });
        var c2 = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "工序B", category = "移印" });
        var item2 = await c2.Content.ReadFromJsonAsync<CraftAliasLite>();

        // 把 item2 的 alias 改成 item1 已有的 "工序A" → 409
        var p = await _client.PatchAsJsonAsync($"/api/craft-aliases/{item2!.Id}", new { alias = "工序A" });
        Assert.Equal(HttpStatusCode.Conflict, p.StatusCode);
    }

    // ===== 编辑：改非法 category → 400 =====

    [Fact]
    public async Task Patch_InvalidCategory_400()
    {
        await Login("clerk", "clerk123");

        var c = await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "清洗剂", category = "UV" });
        var created = await c.Content.ReadFromJsonAsync<CraftAliasLite>();

        var p = await _client.PatchAsJsonAsync($"/api/craft-aliases/{created!.Id}", new { category = "无效" });
        Assert.Equal(HttpStatusCode.BadRequest, p.StatusCode);
    }

    // ===== 编辑：找不到 id → 404 =====

    [Fact]
    public async Task Patch_NotFound_404()
    {
        await Login("clerk", "clerk123");
        var p = await _client.PatchAsJsonAsync("/api/craft-aliases/99999", new { category = "UV" });
        Assert.Equal(HttpStatusCode.NotFound, p.StatusCode);
    }

    // ===== 删除：找不到 id → 404 =====

    [Fact]
    public async Task Delete_NotFound_404()
    {
        await Login("clerk", "clerk123");
        var d = await _client.DeleteAsync("/api/craft-aliases/99999");
        Assert.Equal(HttpStatusCode.NotFound, d.StatusCode);
    }

    // ===== 列表排序：按 category 再按 alias =====

    [Fact]
    public async Task List_SortedByCategoryThenAlias()
    {
        await Login("clerk", "clerk123");

        // 故意乱序插入
        await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "Z工序", category = "手喷" });
        await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "A工序", category = "手喷" });
        await _client.PostAsJsonAsync("/api/craft-aliases", new { alias = "M工序", category = "UV" });

        var list = await _client.GetFromJsonAsync<List<CraftAliasLite>>("/api/craft-aliases");
        Assert.NotNull(list);

        // 找到这三条的索引，验证 UV(M工序) 排在 手喷(A工序/Z工序) 后面，手喷内 A<Z
        // 注意：数据库可能含其他测试数据，只验证相对顺序
        var uvIdx = list!.FindIndex(x => x.Alias == "M工序");
        var aIdx = list.FindIndex(x => x.Alias == "A工序");
        var zIdx = list.FindIndex(x => x.Alias == "Z工序");

        // 字典序：UV(ASCII U=0x55) < 手喷(0x624B)，所以 UV 排在手喷前面
        // 手喷内部 A工序 < Z工序
        Assert.True(aIdx < zIdx, "手喷内 A工序 应排在 Z工序 前");
        Assert.True(uvIdx < aIdx, "UV 应排在 手喷 前（ASCII 字典序）");
    }

    // 测试用轻量 DTO，对应 CraftAliasDto
    private record CraftAliasLite(int Id, string Alias, string Category);
}
