using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

// 订单明细数量编辑：仅「已接单(received)且无排期计划」的订单可改数量（用于修正导入识别错误）。
// 一旦进入排期/实绩，数量锁死。
public class OrderEditQtyTests : IAsyncLifetime
{
    private ApiFactory _f = null!;
    private HttpClient _c = null!;
    public async Task InitializeAsync() { _f = new ApiFactory(); _c = _f.CreateClient(); await _f.SeedAsync(); }
    public Task DisposeAsync() { _c.Dispose(); _f.Dispose(); return Task.CompletedTask; }
    async Task Login(string u, string p) => (await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    private async Task<int> CreateProductAsync(string no)
    {
        var r = await _c.PostAsJsonAsync("/api/products", new
        {
            productNo = no, customerName = "ZURU",
            items = new[] { new { itemName = "兔子", parts = new[] { new { partName = "头", unitCost = 1.0 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task<int> CreateOrderAsync(string orderNo, int productId)
    {
        var r = await _c.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = orderNo, productId,
            lines = new[] { new { itemName = "兔子", partQtys = new[] { new { partName = "头", qty = 100 } } } }
        });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    // 取订单第一个部位的 partQty id（用于按 id 改数量）
    private async Task<int> FirstPartQtyIdAsync(int oid)
    {
        var d = await (await _c.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        return d.GetProperty("lines")[0].GetProperty("partQtys")[0].GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task Patch_QtyOnReceivedOrder_Updates()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("Q1");
        var oid = await CreateOrderAsync("QO1", pid);
        var qid = await FirstPartQtyIdAsync(oid);

        var r = await _c.PatchAsJsonAsync($"/api/orders/{oid}",
            new { lines = new[] { new { partQtys = new[] { new { id = qid, qty = 555 } } } } });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        // 数量已落库
        var d = await (await _c.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(555, d.GetProperty("lines")[0].GetProperty("partQtys")[0].GetProperty("qty").GetInt32());
    }

    [Fact]
    public async Task Patch_QtyOnScheduledOrder_Rejected()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("Q2");
        var oid = await CreateOrderAsync("QO2", pid);
        var qid = await FirstPartQtyIdAsync(oid);
        // 排一条计划 → 订单自动变 scheduled（走真实路径，不手动改状态）
        (await _c.PostAsJsonAsync("/api/plans", new
        {
            plans = new[] { new { planDate = "2026-07-10", lineId = 1, orderId = oid, itemName = "兔子", partName = "头", plannedQty = 50 } }
        })).EnsureSuccessStatusCode();

        var r = await _c.PatchAsJsonAsync($"/api/orders/{oid}",
            new { lines = new[] { new { partQtys = new[] { new { id = qid, qty = 777 } } } } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Detail_QtyEditableFlag_TrueWhenReceivedNoPlan_FalseWithPlan()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("QF");
        var oid = await CreateOrderAsync("QFO", pid);

        // 刚建的 received 订单、无计划 → qtyEditable=true
        var d1 = await (await _c.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(d1.GetProperty("qtyEditable").GetBoolean());

        // 加一条排期计划 → qtyEditable=false
        await _f.WithDbAsync(async db =>
        {
            var lineId = db.ProductionLines.Select(l => l.Id).First();
            db.ProductionPlans.Add(new ProductionPlan
            {
                OrderId = oid, PlanDate = DateTime.UtcNow, PlanType = "daily", LineId = lineId,
                ItemName = "兔子", PartName = "头", PlannedQty = 50, WorkerCount = 1,
                MachineNos = "[]", Status = "planned", CreatedBy = "test",
                CreatedAt = DateTime.UtcNow, LastModifiedAt = DateTime.UtcNow, ModificationHistory = "[]",
            });
            await db.SaveChangesAsync();
        });
        var d2 = await (await _c.GetAsync($"/api/orders/{oid}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(d2.GetProperty("qtyEditable").GetBoolean());
    }

    [Fact]
    public async Task Patch_QtyOnOrderWithPlan_Rejected()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("Q3");
        var oid = await CreateOrderAsync("QO3", pid);
        var qid = await FirstPartQtyIdAsync(oid);
        // 直插一条该订单的排期计划（即便状态仍是 received，也应锁数量）
        await _f.WithDbAsync(async db =>
        {
            var lineId = db.ProductionLines.Select(l => l.Id).First();   // 用 Seed 种的拉别，满足外键
            db.ProductionPlans.Add(new ProductionPlan
            {
                OrderId = oid, PlanDate = DateTime.UtcNow, PlanType = "daily", LineId = lineId,
                ItemName = "兔子", PartName = "头", PlannedQty = 50, WorkerCount = 1,
                MachineNos = "[]", Status = "planned", CreatedBy = "test",
                CreatedAt = DateTime.UtcNow, LastModifiedAt = DateTime.UtcNow, ModificationHistory = "[]",
            });
            await db.SaveChangesAsync();
        });

        var r = await _c.PatchAsJsonAsync($"/api/orders/{oid}",
            new { lines = new[] { new { partQtys = new[] { new { id = qid, qty = 888 } } } } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }
}
