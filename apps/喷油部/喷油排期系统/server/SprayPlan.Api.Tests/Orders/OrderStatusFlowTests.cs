using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

// 订单状态机：只读（人工不可改，仅作废→已接单恢复）+ 自动流转（录实绩→在产/完工）+ 作废限制（有计划禁作废）。
public class OrderStatusFlowTests : IAsyncLifetime
{
    private ApiFactory _f = null!;
    private HttpClient _c = null!;
    public async Task InitializeAsync() { _f = new ApiFactory(); _c = _f.CreateClient(); await _f.SeedAsync(); }
    public Task DisposeAsync() { _c.Dispose(); _f.Dispose(); return Task.CompletedTask; }
    async Task Login(string u, string p) => (await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    private async Task<(int pid, int partId)> CreateProductAsync(string no)
    {
        var r = await _c.PostAsJsonAsync("/api/products", new
        {
            productNo = no, customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        r.EnsureSuccessStatusCode();
        var pid = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var d = await (await _c.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var partId = d.GetProperty("items")[0].GetProperty("parts")[0].GetProperty("id").GetInt32();
        return (pid, partId);
    }

    private async Task<int> CreateOrderAsync(string no, int pid)
    {
        var r = await _c.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = no, productId = pid,
            lines = new[] { new { itemName = "兔子", partQtys = new[] { new { partName = "头", qty = 100 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    // 建 2 条计划行（同订单，便于测"全部录完才完工"），返回计划 id 列表
    private async Task<List<int>> CreatePlansAsync(int oid, int partId, int n)
    {
        var plans = Enumerable.Range(0, n).Select(i => new {
            planDate = $"2026-07-0{i + 1}", lineId = 1, orderId = oid,
            itemName = "兔子", partName = "头", sourcePartId = partId, plannedQty = 50,
        }).ToArray();
        (await _c.PostAsJsonAsync("/api/plans", new { plans })).EnsureSuccessStatusCode();
        var arr = await (await _c.GetAsync($"/api/plans?orderId={oid}")).Content.ReadFromJsonAsync<JsonElement>();
        return Enumerable.Range(0, arr.GetArrayLength()).Select(i => arr[i].GetProperty("id").GetInt32()).ToList();
    }

    private async Task<string> StatusOf(int oid)
        => (await (await _c.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString()!;

    [Fact]
    public async Task ManualStatusChange_Rejected()
    {
        await Login("clerk", "clerk123");
        var (pid, _) = await CreateProductAsync("S1");
        var oid = await CreateOrderAsync("SO1", pid);
        // 试图手动把 received 改成 in_production → 拒绝
        var r = await _c.PatchAsJsonAsync($"/api/orders/{oid}", new { status = "in_production" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("received", await StatusOf(oid));
    }

    [Fact]
    public async Task RestoreArchived_Allowed()
    {
        await Login("clerk", "clerk123");
        var (pid, _) = await CreateProductAsync("S2");
        var oid = await CreateOrderAsync("SO2", pid);
        (await _c.DeleteAsync($"/api/orders/{oid}")).EnsureSuccessStatusCode();   // 作废
        Assert.Equal("archived", await StatusOf(oid));
        // 作废→已接单 恢复 允许
        var r = await _c.PatchAsJsonAsync($"/api/orders/{oid}", new { status = "received" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("received", await StatusOf(oid));
    }

    [Fact]
    public async Task RecordOnePlan_OrderBecomesInProduction()
    {
        await Login("clerk", "clerk123");
        var (pid, partId) = await CreateProductAsync("S3");
        var oid = await CreateOrderAsync("SO3", pid);
        var planIds = await CreatePlansAsync(oid, partId, 2);   // 排 2 行 → scheduled
        Assert.Equal("scheduled", await StatusOf(oid));
        // 只录 1 行实绩 → 在产
        (await _c.PatchAsJsonAsync($"/api/plans/{planIds[0]}", new { goodQty = 30 })).EnsureSuccessStatusCode();
        Assert.Equal("in_production", await StatusOf(oid));
    }

    [Fact]
    public async Task RecordAllPlans_OrderBecomesCompleted()
    {
        await Login("clerk", "clerk123");
        var (pid, partId) = await CreateProductAsync("S4");
        var oid = await CreateOrderAsync("SO4", pid);   // 「头」需求 100
        var planIds = await CreatePlansAsync(oid, partId, 2);
        // 两行各录 50，累计入库 100 = 需求 → 完工（完工按部位真实需求判，非"所有计划行录完"）
        foreach (var id in planIds)
            (await _c.PatchAsJsonAsync($"/api/plans/{id}", new { goodQty = 50 })).EnsureSuccessStatusCode();
        Assert.Equal("completed", await StatusOf(oid));
    }

    [Fact]
    public async Task ArchiveOrderWithPlan_Rejected()
    {
        await Login("clerk", "clerk123");
        var (pid, partId) = await CreateProductAsync("S5");
        var oid = await CreateOrderAsync("SO5", pid);
        await CreatePlansAsync(oid, partId, 1);   // 有计划
        // 有排期计划 → 作废被拒
        var r = await _c.DeleteAsync($"/api/orders/{oid}");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.NotEqual("archived", await StatusOf(oid));
    }
}
