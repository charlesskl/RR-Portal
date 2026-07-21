using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 排期计划 + 甘特聚合 集成测试：鉴权 + 校验 + 状态联动 + 软删 + 预计出单日算法。
public class PlansScheduleApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();   // 含 胡旗拉 id=1
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task LoginAsync(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // 建产品(子件兔子+部位头)，部位设机喷·单台日产能50·标准1台；返回 (产品id, 子件id)
    private async Task<(int pid, int itemId)> CreateProductWithCapacityAsync()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "G1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var pid = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        var itemId = item.GetProperty("id").GetInt32();
        var partId = item.GetProperty("parts")[0].GetProperty("id").GetInt32();
        (await _client.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}",
            new { dailyCapacity = 50, productionMode = "machine", stdMachineCount = 1 })).EnsureSuccessStatusCode();
        return (pid, itemId);
    }

    // 建订单(子件兔子·部位头 需求100)，返回订单 id
    private async Task<int> CreateOrderAsync(string no, int pid, int itemId)
    {
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var partId = detail.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("id").GetInt32();
        var r = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = no, productId = pid,
            lines = new[] { new { itemName = "兔子", sourceItemId = itemId, partQtys = new[] { new { partName = "头", sourcePartId = partId, qty = 100 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task CreatePlanAsync(int orderId, string planDate = "2026-06-10", int qty = 50)
    {
        var r = await _client.PostAsJsonAsync("/api/plans", new
        {
            plans = new[] { new { planDate, lineId = 1, orderId, itemName = "兔子", partName = "头", plannedQty = qty } }
        });
        r.EnsureSuccessStatusCode();
    }

    private async Task<int> FirstPlanIdAsync(int orderId)
    {
        var arr = await (await _client.GetAsync($"/api/plans?orderId={orderId}")).Content.ReadFromJsonAsync<JsonElement>();
        return arr[0].GetProperty("id").GetInt32();
    }

    // ---------- 计划接口 ----------
    [Fact]
    public async Task Plans_Get_Unauthenticated_Returns401()
        => Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/plans")).StatusCode);

    [Fact]
    public async Task Plans_Create_AsViewer_Forbidden()
    {
        await LoginAsync("viewer", "viewer123");
        var r = await _client.PostAsJsonAsync("/api/plans", new { plans = new[] { new { planDate = "2026-06-10", lineId = 1, orderId = 1, itemName = "兔子", partName = "头", plannedQty = 50 } } });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Plans_Create_EmptyArray_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/plans", new { plans = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Plans_Create_MissingFields_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/plans", new { plans = new[] { new { planDate = "2026-06-10", lineId = 1, orderId = 1, itemName = "兔子", partName = "", plannedQty = 50 } } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Plans_Create_QtyNotPositive_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/plans", new { plans = new[] { new { planDate = "2026-06-10", lineId = 1, orderId = 1, itemName = "兔子", partName = "头", plannedQty = 0 } } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Plans_Create_AdvancesOrderToScheduled()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("ADV", pid, itemId);   // 新建即 received
        await CreatePlanAsync(oid);
        var detail = await (await _client.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("scheduled", detail.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Plans_Get_ExcludesSoftDeleted()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("SD", pid, itemId);
        await CreatePlanAsync(oid);
        var planId = await FirstPlanIdAsync(oid);
        (await _client.DeleteAsync($"/api/plans/{planId}")).EnsureSuccessStatusCode();
        var arr = await (await _client.GetAsync($"/api/plans?orderId={oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, arr.GetArrayLength());   // 软删后查不到
    }

    [Fact]
    public async Task Plans_Patch_QtyNotPositive_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("PQ", pid, itemId);
        await CreatePlanAsync(oid);
        var planId = await FirstPlanIdAsync(oid);
        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { plannedQty = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Plans_Patch_UpdatesPlannedQty()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("PU", pid, itemId);
        await CreatePlanAsync(oid, qty: 50);
        var planId = await FirstPlanIdAsync(oid);
        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { plannedQty = 80 });
        r.EnsureSuccessStatusCode();
        Assert.Equal(80, (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("plannedQty").GetInt32());
    }

    [Fact]
    public async Task Plans_Delete_NotFound_Returns404()
    {
        await LoginAsync("clerk", "clerk123");
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync("/api/plans/9999")).StatusCode);
    }

    // ---------- 周排：日期区间 + 换拉 ----------
    [Fact]
    public async Task Plans_Get_ByDateRange_ReturnsOnlyInRange()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("RNG", pid, itemId);
        await CreatePlanAsync(oid, planDate: "2026-06-15");
        await CreatePlanAsync(oid, planDate: "2026-06-18");
        await CreatePlanAsync(oid, planDate: "2026-06-22");
        // 周 6/15~6/21 内应只剩 6/15、6/18 两条
        var rows = await (await _client.GetAsync("/api/plans?lineId=1&from=2026-06-15&to=2026-06-21")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, rows.GetArrayLength());
    }

    [Fact]
    public async Task Plans_Patch_ChangesLineId()
    {
        await LoginAsync("admin", "admin123");
        // 建第二条拉，再按名字取其 id（不依赖 POST 返回体结构）
        (await _client.PostAsJsonAsync("/api/lines", new { name = "目标拉", workshop = "兴信A", craftType = "移印" })).EnsureSuccessStatusCode();
        var lines = await (await _client.GetAsync("/api/lines")).Content.ReadFromJsonAsync<JsonElement>();
        var line2 = lines.EnumerateArray().First(l => l.GetProperty("name").GetString() == "目标拉").GetProperty("id").GetInt32();

        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("MOV", pid, itemId);
        await CreatePlanAsync(oid);   // 落在胡旗拉 id=1
        var planId = await FirstPlanIdAsync(oid);

        (await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { lineId = line2 })).EnsureSuccessStatusCode();
        var moved = await (await _client.GetAsync($"/api/plans?lineId={line2}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, moved.GetArrayLength());
    }

    // ---------- 甘特聚合（算法）----------
    [Fact]
    public async Task Schedule_ExpectedOutDate_UsesBucketAlgorithm()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        await CreateOrderAsync("SCH", pid, itemId);   // 需求100，无计划→用 stdMachineCount=1
        var arr = await (await _client.GetAsync("/api/schedule?today=2026-06-01")).Content.ReadFromJsonAsync<JsonElement>();
        var ord = arr.EnumerateArray().First(o => o.GetProperty("externalOrderNo").GetString() == "SCH");
        Assert.False(ord.GetProperty("scheduled").GetBoolean());
        // remDays = ceil(100 / (1台 × 50)) = 2 → today(06-01) + 2 = 06-03（日期不串天）
        Assert.Equal("2026-06-03", ord.GetProperty("expectedOutDate").GetString());
        Assert.Equal(100, ord.GetProperty("demandParts")[0].GetProperty("totalDemand").GetInt32());
    }

    [Fact]
    public async Task Schedule_ScheduledAndFirstPlanDate_AfterPlan()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId) = await CreateProductWithCapacityAsync();
        var oid = await CreateOrderAsync("SF", pid, itemId);
        await CreatePlanAsync(oid, planDate: "2026-06-10");
        var arr = await (await _client.GetAsync("/api/schedule?today=2026-06-01")).Content.ReadFromJsonAsync<JsonElement>();
        var ord = arr.EnumerateArray().First(o => o.GetProperty("externalOrderNo").GetString() == "SF");
        Assert.True(ord.GetProperty("scheduled").GetBoolean());
        Assert.Equal("2026-06-10", ord.GetProperty("firstPlanDate").GetString());   // 日期回读不串天
    }
}
