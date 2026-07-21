using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 按订单撤销排期：删除该订单全部排期计划（软删），订单状态退回 received。
// 已录实绩(recorded)的订单不可撤销。
public class UnscheduleOrderTests : IAsyncLifetime
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

    // 给订单加一条排期计划（status 可指定 planned/recorded），订单推进到 scheduled
    private async Task AddPlanAsync(int oid, string status)
    {
        await _f.WithDbAsync(async db =>
        {
            var lineId = db.ProductionLines.Select(l => l.Id).First();
            db.ProductionPlans.Add(new ProductionPlan
            {
                OrderId = oid, PlanDate = DateTime.UtcNow, PlanType = "daily", LineId = lineId,
                ItemName = "兔子", PartName = "头", PlannedQty = 50, WorkerCount = 1,
                MachineNos = "[]", Status = status, CreatedBy = "test",
                GoodQty = status == "recorded" ? 50 : (int?)null,
                CreatedAt = DateTime.UtcNow, LastModifiedAt = DateTime.UtcNow, ModificationHistory = "[]",
            });
            var o = await db.Orders.FindAsync(oid);
            if (o is not null) o.Status = "scheduled";
            await db.SaveChangesAsync();
        });
    }

    [Fact]
    public async Task Unschedule_ScheduledOrder_SoftDeletesPlansAndResetsStatus()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("U1");
        var oid = await CreateOrderAsync("UO1", pid);
        await AddPlanAsync(oid, "planned");

        var r = await _c.PostAsync($"/api/schedule/orders/{oid}/unschedule", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        // 计划已软删（列表查不到）
        var plans = await _c.GetFromJsonAsync<JsonElement>($"/api/plans?orderId={oid}");
        Assert.Equal(0, plans.GetArrayLength());

        // 订单退回 received
        var d = await _c.GetFromJsonAsync<JsonElement>($"/api/orders/{oid}");
        Assert.Equal("received", d.GetProperty("status").GetString());
        // 退回后数量可改
        Assert.True(d.GetProperty("qtyEditable").GetBoolean());
    }

    [Fact]
    public async Task Unschedule_OrderWithRecordedPlan_Rejected()
    {
        await Login("clerk", "clerk123");
        var pid = await CreateProductAsync("U2");
        var oid = await CreateOrderAsync("UO2", pid);
        await AddPlanAsync(oid, "recorded");

        var r = await _c.PostAsync($"/api/schedule/orders/{oid}/unschedule", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);

        // 计划仍在、状态未变
        var plans = await _c.GetFromJsonAsync<JsonElement>($"/api/plans?orderId={oid}");
        Assert.Equal(1, plans.GetArrayLength());
    }

    [Fact]
    public async Task Unschedule_NotFoundOrder_Returns404()
    {
        await Login("clerk", "clerk123");
        var r = await _c.PostAsync("/api/schedule/orders/9999/unschedule", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Unschedule_AsViewer_Forbidden()
    {
        await Login("viewer", "viewer123");
        var r = await _c.PostAsync("/api/schedule/orders/1/unschedule", null);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }
}
