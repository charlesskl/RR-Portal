using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

// 阶段一新增能力的集成测试：拉别工艺类型、机台号按拉别唯一、批量录入、工艺继承、节假日编辑。
public class BasicV2Tests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();   // 胡旗拉(id=1, 默认工艺移印) + 机台 5#
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task Clerk() =>
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();

    // 新建一条拉，返回其 id
    private async Task<int> CreateLine(string name, string craft)
    {
        var r = await _client.PostAsJsonAsync("/api/lines", new { name, workshop = "兴信A", craftType = craft });
        r.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Line_Create_InvalidCraft_Returns400()
    {
        await Clerk();
        var r = await _client.PostAsJsonAsync("/api/lines", new { name = "怪拉", workshop = "兴信A", craftType = "喷漆" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Machine_SameNo_DifferentLine_Allowed()
    {
        await Clerk();
        var lineB = await CreateLine("B拉", "手喷");
        // 5# 已存在于 1 号拉；在 B 拉再建 5# 应当允许（按拉别唯一）
        var r = await _client.PostAsJsonAsync("/api/machines", new { machineNo = "5#", lineId = lineB });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
    }

    [Fact]
    public async Task Machine_InheritsLineCraft_UV()
    {
        await Clerk();
        var uv = await CreateLine("UV拉", "UV");
        var r = await _client.PostAsJsonAsync("/api/machines", new { machineNo = "U1#", lineId = uv });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadAsStringAsync();
        Assert.Contains("\"isUV\":true", body);   // UV 拉的机台自动标记 UV
    }

    [Fact]
    public async Task Machine_Batch_CreatesNewSkipsExisting()
    {
        await Clerk();
        // 1 号拉已有 5#；批量贴 "5#, 10#, 11#" → 建 10#/11#，跳过 5#（逗号分隔，不按空格切）
        var r = await _client.PostAsJsonAsync("/api/machines/batch", new { lineId = 1, text = "5#, 10#, 11#" });
        r.EnsureSuccessStatusCode();
        var root = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(2, root.GetProperty("created").GetInt32());
        Assert.Contains("5#", root.GetProperty("skippedExisting").EnumerateArray().Select(x => x.GetString()));
    }

    [Fact]
    public async Task Machine_Batch_KeepsNamesWithSpaces()
    {
        await Clerk();
        var uv = await CreateLine("UV拉", "UV");
        // 机台名含空格与中文括号，按逗号分隔应识别成 2 台完整名字，不被空格劈碎
        var r = await _client.PostAsJsonAsync("/api/machines/batch", new { lineId = uv, text = "1 号机（世通），2 号机（世通）" });
        r.EnsureSuccessStatusCode();
        var root = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(2, root.GetProperty("created").GetInt32());
        Assert.Contains("1 号机（世通）", root.GetProperty("createdNos").EnumerateArray().Select(x => x.GetString()));
    }

    [Fact]
    public async Task Line_CraftChange_SyncsMachineUVFlag()
    {
        await Clerk();
        // 把 1 号拉工艺改成 UV，其机台 5# 的 isUV 应被同步为 true
        var p = await _client.PatchAsJsonAsync("/api/lines/1", new { craftType = "UV" });
        p.EnsureSuccessStatusCode();
        var list = await (await _client.GetAsync("/api/machines")).Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(list);
        var m5 = doc.RootElement.EnumerateArray().First(m => m.GetProperty("machineNo").GetString() == "5#");
        Assert.True(m5.GetProperty("isUV").GetBoolean());
    }

    [Fact]
    public async Task Holiday_Patch_UpdatesRemark()
    {
        await Clerk();
        var c = await _client.PostAsJsonAsync("/api/holidays", new { date = "2026-12-25", type = "holiday", remark = "测试" });
        c.EnsureSuccessStatusCode();
        var id = JsonDocument.Parse(await c.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetInt32();
        var p = await _client.PatchAsJsonAsync($"/api/holidays/{id}", new { remark = "圣诞改" });
        p.EnsureSuccessStatusCode();
        Assert.Contains("圣诞改", await p.Content.ReadAsStringAsync());
    }
}
