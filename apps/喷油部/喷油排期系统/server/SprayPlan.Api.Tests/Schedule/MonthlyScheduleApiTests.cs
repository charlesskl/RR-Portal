using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 月排自动化集成测试：鉴权 + 生成预览不落库 + 保存/重排落库并联动状态。
public class MonthlyScheduleApiTests : IAsyncLifetime
{
    private ApiFactory _f = null!;
    private HttpClient _c = null!;
    public async Task InitializeAsync() { _f = new ApiFactory(); _c = _f.CreateClient(); await _f.SeedAsync(); }
    public Task DisposeAsync() { _c.Dispose(); _f.Dispose(); return Task.CompletedTask; }
    async Task Login(string u, string p) => (await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    [Fact]
    public async Task Auto_Unauthenticated_401()
    {
        var r = await _c.PostAsJsonAsync("/api/schedule/auto", new { month = "2026-07", mode = "incremental", today = "2026-06-25" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Auto_GeneratesDraft_NotPersisted()
    {
        await Login("clerk", "clerk123");
        await SeedOneOrderAsync("2026-07-10", 150, 100);
        var resp = await _c.PostAsJsonAsync("/api/schedule/auto", new { month = "2026-07", mode = "incremental", today = "2026-06-25" });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("draft").GetArrayLength() >= 1);
        // 草稿未落库
        var plans = await _c.GetFromJsonAsync<JsonElement>("/api/plans?planDate=2026-07-08");
        Assert.Equal(0, plans.GetArrayLength());
    }

    [Fact]
    public async Task Auto_ZeroCapacityPart_WarnsAndDoesNotCreatePartialOrderDraft()
    {
        await Login("clerk", "clerk123");
        await SeedOneOrderAsync("2026-07-10", 150, 0);

        var body = await (await _c.PostAsJsonAsync("/api/schedule/auto",
            new { month = "2026-07", mode = "incremental", today = "2026-06-25" }))
            .Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(0, body.GetProperty("draft").GetArrayLength());
        var warning = Assert.Single(body.GetProperty("noCapacityOrders").EnumerateArray());
        Assert.Equal("MO", warning.GetProperty("externalOrderNo").GetString());
        Assert.Equal("zero_capacity", warning.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Commit_PersistsAndSchedules()
    {
        await Login("clerk", "clerk123");
        await SeedOneOrderAsync("2026-07-10", 150, 100);
        var gen = await (await _c.PostAsJsonAsync("/api/schedule/auto", new { month = "2026-07", mode = "incremental", today = "2026-06-25" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var draft = gen.GetProperty("draft");
        var commit = await _c.PostAsJsonAsync("/api/schedule/auto/commit",
            new { month = "2026-07", mode = "incremental", draft });
        Assert.Equal(HttpStatusCode.OK, commit.StatusCode);
        // 算法由倒排改逐天正排：从 today=2026-06-25(周四,工作日)起正向排，首日即 06-25（而非旧倒排的交货日附近 07-08）。
        var plans = await _c.GetFromJsonAsync<JsonElement>("/api/plans?planDate=2026-06-25");
        Assert.True(plans.GetArrayLength() >= 1);
    }

    // craftPasses=2 部位 → 月排草稿至少含 stepNo 1 和 2（摊道生效）
    [Fact]
    public async Task Auto_MultiPass_GeneratesTwoSteps()
    {
        await Login("clerk", "clerk123");
        // 建产品 + 部位，PATCH 设 craftPasses=2（移印两道）、日产能足够当天做完
        var presp = await _c.PostAsJsonAsync("/api/products", new
        {
            productNo = "MP1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        presp.EnsureSuccessStatusCode();
        var pid = (await presp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _c.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        var itemId = item.GetProperty("id").GetInt32();
        var partId = item.GetProperty("parts")[0].GetProperty("id").GetInt32();
        (await _c.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}",
            new { dailyCapacity = 1000, productionMode = "machine", stdMachineCount = 1, craft = "移印", craftPasses = 2 })).EnsureSuccessStatusCode();
        (await _c.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = "MPO", productId = pid, orderDate = "2026-06-01", deliveryDate = "2026-07-31",
            lines = new[] { new { itemName = "兔子", sourceItemId = itemId, partQtys = new[] { new { partName = "头", sourcePartId = partId, qty = 100 } } } }
        })).EnsureSuccessStatusCode();

        var gen = await (await _c.PostAsJsonAsync("/api/schedule/auto", new { month = "2026-07", mode = "incremental", today = "2026-07-01" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var draft = gen.GetProperty("draft").EnumerateArray().ToList();
        var steps = draft.Select(r => r.GetProperty("stepNo").GetInt32()).Distinct().OrderBy(x => x).ToList();
        Assert.Contains(1, steps);
        Assert.Contains(2, steps);
    }

    // 建：产品(1子件1部位,dailyCapacity·机喷·标准1台) + 订单(deliveryDate, 子件勾数量=demand)。
    private async Task SeedOneOrderAsync(string deliveryDate, int demand, int dailyCapacity)
    {
        // 1) 建产品（子件兔子 + 部位头）
        var presp = await _c.PostAsJsonAsync("/api/products", new
        {
            productNo = "M1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        presp.EnsureSuccessStatusCode();
        var pid = (await presp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _c.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        var itemId = item.GetProperty("id").GetInt32();
        var partId = item.GetProperty("parts")[0].GetProperty("id").GetInt32();
        // 2) 设部位日产能（机喷·标准1台·移印工艺→对应胡旗拉 craftType=移印）
        (await _c.PatchAsJsonAsync($"/api/products/{pid}/parts/{partId}",
            new { dailyCapacity, productionMode = "machine", stdMachineCount = 1, craft = "移印" })).EnsureSuccessStatusCode();
        // 3) 建订单（带下单日 + 交货日 + 部位填数量 = demand）
        // ⚠️ orderDate 必须显式传，月排纳入口径按“下单日 < 下月月初 && 交期 >= 本月月初”判断。
        // 否则默认取运行当天，跨月筛选测试会受真实日期影响。
        var oresp = await _c.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = "MO", productId = pid, orderDate = "2026-06-01", deliveryDate,
            lines = new[] { new { itemName = "兔子", sourceItemId = itemId, partQtys = new[] { new { partName = "头", sourcePartId = partId, qty = demand } } } }
        });
        oresp.EnsureSuccessStatusCode();
    }
}
