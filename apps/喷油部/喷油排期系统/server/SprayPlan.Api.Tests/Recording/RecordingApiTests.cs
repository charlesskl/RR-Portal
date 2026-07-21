using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Recording;

// 实绩录入(PATCH plans 实绩分支) + Excel 导出 集成测试。
public class RecordingApiTests : IAsyncLifetime
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

    // 建产品：部位头 核2+人工3+油漆0（综合工价 5），返回 (产品id, 子件id, 部位id)
    private async Task<(int pid, int itemId, int partId)> CreateProductPricedAsync()
    {
        var resp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "R1", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 2.0, laborPrice = 3.0, paintCost = 0.0 } } } }
        });
        resp.EnsureSuccessStatusCode();
        var pid = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        return (pid, item.GetProperty("id").GetInt32(), item.GetProperty("parts")[0].GetProperty("id").GetInt32());
    }

    private async Task<int> CreateOrderAsync(string no, int pid, int itemId)
    {
        var r = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = no, customerName = "兴信", productId = pid,
            lines = new[] { new { itemName = "兔子", colorName = "粉", sourceItemId = itemId, qtys = new[] { new { specName = "标准", qty = 100 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task<int> CreatePlanGetIdAsync(int orderId, int partId, string planDate = "2026-06-10")
    {
        (await _client.PostAsJsonAsync("/api/plans", new
        {
            plans = new[] { new { planDate, lineId = 1, orderId, itemName = "兔子", partName = "头", sourcePartId = partId, plannedQty = 50 } }
        })).EnsureSuccessStatusCode();
        var arr = await (await _client.GetAsync($"/api/plans?orderId={orderId}")).Content.ReadFromJsonAsync<JsonElement>();
        return arr[0].GetProperty("id").GetInt32();
    }

    // 建 2 部位产品(头/脚) + 订单(各需求100)，返回 (订单id, 头部位id, 脚部位id)
    private async Task<(int oid, int headPartId, int footPartId)> Create2PartOrderAsync(string orderNo)
    {
        var pResp = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "P2", customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] {
                new { partName = "头", unitCost = 2.0, laborPrice = 3.0, paintCost = 0.0 },
                new { partName = "脚", unitCost = 1.0, laborPrice = 1.0, paintCost = 0.0 } } } }
        });
        pResp.EnsureSuccessStatusCode();
        var pid = (await pResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail = await (await _client.GetAsync($"/api/products/{pid}")).Content.ReadFromJsonAsync<JsonElement>();
        var item = detail.GetProperty("items")[0];
        var itemId = item.GetProperty("id").GetInt32();
        var parts = item.GetProperty("parts");
        int headPid = parts[0].GetProperty("id").GetInt32(), footPid = parts[1].GetProperty("id").GetInt32();

        var oResp = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = orderNo, productId = pid,
            lines = new[] { new { itemName = "兔子", sourceItemId = itemId, partQtys = new[] {
                new { partName = "头", sourcePartId = headPid, qty = 100 },
                new { partName = "脚", sourcePartId = footPid, qty = 100 } } } }
        });
        oResp.EnsureSuccessStatusCode();
        var oid = (await oResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        return (oid, headPid, footPid);
    }

    private async Task<int> CreatePlanForPartAsync(int orderId, string partName, int partId, int qty)
    {
        (await _client.PostAsJsonAsync("/api/plans", new
        {
            plans = new[] { new { planDate = "2026-06-10", lineId = 1, orderId, itemName = "兔子", partName, sourcePartId = partId, plannedQty = qty } }
        })).EnsureSuccessStatusCode();
        var arr = await (await _client.GetAsync($"/api/plans?orderId={orderId}")).Content.ReadFromJsonAsync<JsonElement>();
        foreach (var el in arr.EnumerateArray())
            if (el.GetProperty("partName").GetString() == partName) return el.GetProperty("id").GetInt32();
        throw new Xunit.Sdk.XunitException("找不到该部位的计划行");
    }

    private async Task<string> OrderStatusAsync(int oid)
        => (await (await _client.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("status").GetString()!;

    // BUG 回归：订单有 2 部位需求，只排录其中 1 个部位 → 不应判完工（应 in_production）
    [Fact]
    public async Task RecordingOnePartOfTwo_DoesNotCompleteOrder()
    {
        await LoginAsync("clerk", "clerk123");
        var (oid, headPid, _) = await Create2PartOrderAsync("TWO1");
        var headPlan = await CreatePlanForPartAsync(oid, "头", headPid, 100);

        // 只录「头」满 100，「脚」根本没排没录
        await _client.PatchAsJsonAsync($"/api/plans/{headPlan}", new { goodQty = 100 });

        Assert.Equal("in_production", await OrderStatusAsync(oid));   // 不是 completed
    }

    // 两部位都排满录满 → 订单完工
    [Fact]
    public async Task RecordingAllParts_CompletesOrder()
    {
        await LoginAsync("clerk", "clerk123");
        var (oid, headPid, footPid) = await Create2PartOrderAsync("TWO2");
        var headPlan = await CreatePlanForPartAsync(oid, "头", headPid, 100);
        var footPlan = await CreatePlanForPartAsync(oid, "脚", footPid, 100);

        await _client.PatchAsJsonAsync($"/api/plans/{headPlan}", new { goodQty = 100 });
        await _client.PatchAsJsonAsync($"/api/plans/{footPlan}", new { goodQty = 100 });

        Assert.Equal("completed", await OrderStatusAsync(oid));
    }

    // ---------- 实绩录入 ----------
    [Fact]
    public async Task Patch_GoodQty_ComputesProductionValue()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("REC1", pid, itemId);
        var planId = await CreatePlanGetIdAsync(oid, partId);

        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 100 });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        // 产值 = 100 × (核2+人工3+油漆0) = 500，状态转 recorded
        Assert.Equal(500.0, body.GetProperty("productionValue").GetDouble());
        Assert.Equal("recorded", body.GetProperty("status").GetString());
        Assert.Equal(100, body.GetProperty("goodQty").GetInt32());
    }

    [Fact]
    public async Task Patch_SavesReportedQty_AndProductionValueUsesGoodQty()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("RECR", pid, itemId);
        var planId = await CreatePlanGetIdAsync(oid, partId);

        // 入库数 80、员工报数 100：产值按入库数 80×5=400；reportedQty 存 100
        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 80, reportedQty = 100 });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(400.0, body.GetProperty("productionValue").GetDouble());
        Assert.Equal(80, body.GetProperty("goodQty").GetInt32());

        // 重新查 DTO 确认 reportedQty 落库
        var arr = await (await _client.GetAsync($"/api/plans?orderId={oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, arr[0].GetProperty("reportedQty").GetInt32());
    }

    [Fact]
    public async Task Patch_GoodQtyNegative_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("REC2", pid, itemId);
        var planId = await CreatePlanGetIdAsync(oid, partId);

        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = -5 });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Patch_GoodQty_ChangeRecomputesValue()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("REC3", pid, itemId);
        var planId = await CreatePlanGetIdAsync(oid, partId);

        await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 100 });   // 首次录 → 500
        var r = await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 80 }); // 改录 → 400
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(400.0, body.GetProperty("productionValue").GetDouble());   // 80 × 5
    }

    // ---------- 导出 ----------
    [Fact]
    public async Task Export_Unauthenticated_Returns401()
        => Assert.Equal(HttpStatusCode.Unauthorized,
            (await _client.PostAsJsonAsync("/api/recording/export", new { date = "2026-06-10", mode = "plan" })).StatusCode);

    [Fact]
    public async Task Export_MissingDate_Returns400()
    {
        await LoginAsync("clerk", "clerk123");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/api/recording/export", new { mode = "plan" })).StatusCode);
    }

    [Fact]
    public async Task Export_PlanMode_ReturnsXlsx()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("REC4", pid, itemId);
        await CreatePlanGetIdAsync(oid, partId, planDate: "2026-06-10");

        var r = await _client.PostAsJsonAsync("/api/recording/export", new { date = "2026-06-10", mode = "plan" });
        r.EnsureSuccessStatusCode();
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            r.Content.Headers.ContentType!.MediaType);
        var bytes = await r.Content.ReadAsByteArrayAsync();
        Assert.True(bytes.Length > 0);                       // 生成了非空 xlsx
        Assert.Equal(new byte[] { 0x50, 0x4B }, bytes[..2]); // xlsx 是 zip，魔数 "PK"
    }

    [Fact]
    public async Task Export_ActualMode_WithLineNotes_ReturnsXlsx()
    {
        await LoginAsync("clerk", "clerk123");
        var (pid, itemId, partId) = await CreateProductPricedAsync();
        var oid = await CreateOrderAsync("REC5", pid, itemId);
        var planId = await CreatePlanGetIdAsync(oid, partId, planDate: "2026-06-10");
        await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 50, reportedQty = 60 });

        var body = new
        {
            date = "2026-06-10",
            mode = "actual",
            lineNotes = new[] { new { lineId = 1, headerText = "35人，实际29人", miscText = "杂工11人" } }
        };
        var r = await _client.PostAsJsonAsync("/api/recording/export", body);
        r.EnsureSuccessStatusCode();
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            r.Content.Headers.ContentType!.MediaType);
        var bytes = await r.Content.ReadAsByteArrayAsync();
        Assert.True(bytes.Length > 0);
        Assert.Equal(new byte[] { 0x50, 0x4B }, bytes[..2]);
    }
}
