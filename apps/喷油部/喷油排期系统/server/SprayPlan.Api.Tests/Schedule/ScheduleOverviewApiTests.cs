using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 排期总览看板接口 GET /api/schedule/overview 集成测试：
// 鉴权 401 / 缺参 400 / 落库后返回拉别清单 + 区间计划明细（含 stepNo/craft/partName）。
public class ScheduleOverviewApiTests : IAsyncLifetime
{
    private ApiFactory _f = null!;
    private HttpClient _c = null!;
    public async Task InitializeAsync() { _f = new ApiFactory(); _c = _f.CreateClient(); await _f.SeedAsync(); }
    public Task DisposeAsync() { _c.Dispose(); _f.Dispose(); return Task.CompletedTask; }
    async Task Login(string u, string p) => (await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    [Fact]
    public async Task Overview_Unauthenticated_401()
    {
        var r = await _c.GetAsync("/api/schedule/overview?from=2026-06-01&to=2026-06-30");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Overview_MissingParams_400()
    {
        await Login("clerk", "clerk123");
        var r = await _c.GetAsync("/api/schedule/overview");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Overview_ReturnsLinesAndPlans()
    {
        await Login("clerk", "clerk123");
        await SeedOneOrderAsync("2026-07-10", 150, 100);
        // 生成月排 + 落库（逐天正排：today=2026-06-25 起）
        var gen = await (await _c.PostAsJsonAsync("/api/schedule/auto", new { month = "2026-07", mode = "incremental", today = "2026-06-25" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var draft = gen.GetProperty("draft");
        (await _c.PostAsJsonAsync("/api/schedule/auto/commit", new { month = "2026-07", mode = "incremental", draft })).EnsureSuccessStatusCode();

        var body = await _c.GetFromJsonAsync<JsonElement>("/api/schedule/overview?from=2026-06-01&to=2026-07-31");
        // 拉别清单：至少一条活跃拉
        Assert.True(body.GetProperty("lines").GetArrayLength() >= 1);
        // 计划行：至少一条，且带 stepNo/craft/partName（看板据此铺格子 + 上色）
        var plans = body.GetProperty("plans").EnumerateArray().ToList();
        Assert.True(plans.Count >= 1);
        var p0 = plans[0];
        Assert.True(p0.TryGetProperty("stepNo", out _));
        Assert.True(p0.TryGetProperty("craft", out _));
        Assert.False(string.IsNullOrEmpty(p0.GetProperty("partName").GetString()));
        Assert.True(p0.GetProperty("plannedQty").GetInt32() > 0);
    }

    [Fact]
    public async Task Overview_EmptyRange_ReturnsNoPlans()
    {
        await Login("clerk", "clerk123");
        // 没落任何计划的区间：plans 为空，但 lines 仍返回
        var body = await _c.GetFromJsonAsync<JsonElement>("/api/schedule/overview?from=2020-01-01&to=2020-01-07");
        Assert.Equal(0, body.GetProperty("plans").GetArrayLength());
    }

    // 建：产品(1子件1部位,移印·机喷·标准1台) + 订单(交货日, 部位数量=demand)。与 MonthlyScheduleApiTests 同款。
    private async Task SeedOneOrderAsync(string deliveryDate, int demand, int dailyCapacity)
    {
        var presp = await _c.PostAsJsonAsync("/api/products", new
        {
            productNo = "OV1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        presp.EnsureSuccessStatusCode();
        var pid = (await presp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _c.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        var itemId = item.GetProperty("id").GetInt32();
        var partId = item.GetProperty("parts")[0].GetProperty("id").GetInt32();
        (await _c.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}",
            new { dailyCapacity, productionMode = "machine", stdMachineCount = 1, craft = "移印" })).EnsureSuccessStatusCode();
        (await _c.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = "OVO", productId = pid, orderDate = "2026-06-01", deliveryDate,
            lines = new[] { new { itemName = "兔子", sourceItemId = itemId, partQtys = new[] { new { partName = "头", sourcePartId = partId, qty = demand } } } }
        })).EnsureSuccessStatusCode();
    }
}
