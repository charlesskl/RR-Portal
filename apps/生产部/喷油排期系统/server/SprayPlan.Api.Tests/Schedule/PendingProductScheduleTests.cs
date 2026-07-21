using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 回归测试：库里存在「待补产品订单」(ProductId=null / PendingProduct=true) 时，
// 排期相关接口不能崩（500）。此前 ScheduleController 用 o.Product!.ProductNo 强解空，
// 一旦 PDF 导入产生待补产品订单，/api/schedule 整接口 500 → 前端整站(含登录页)打不开。
public class PendingProductScheduleTests : IAsyncLifetime
{
    private ApiFactory _f = null!;
    private HttpClient _c = null!;
    public async Task InitializeAsync() { _f = new ApiFactory(); _c = _f.CreateClient(); await _f.SeedAsync(); }
    public Task DisposeAsync() { _c.Dispose(); _f.Dispose(); return Task.CompletedTask; }
    async Task Login(string u, string p) => (await _c.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // 直接往测试库插一条待补产品订单（模拟真实库 #5 CMC2600091 的形态）
    private async Task SeedPendingOrderAsync()
    {
        await _f.WithDbAsync(async db =>
        {
            db.Orders.Add(new Order
            {
                ExternalOrderNo = "CMC-PENDING",
                ProductId = null,
                PendingProduct = true,
                OrderDate = DateTime.UtcNow,
                DeliveryDate = DateTime.UtcNow.AddDays(10),
                Status = "received",
                CreatedBy = "test",
            });
            await db.SaveChangesAsync();
        });
    }

    [Fact]
    public async Task Schedule_WithPendingProductOrder_DoesNotCrash()
    {
        await Login("clerk", "clerk123");
        await SeedPendingOrderAsync();

        var resp = await _c.GetAsync("/api/schedule?today=2026-06-18");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        // 待补产品订单应出现在结果里，productNo 走兜底文案而非崩溃
        Assert.True(body.GetArrayLength() >= 1);
    }

    [Fact]
    public async Task SchedulableOrders_WithPendingProductOrder_DoesNotCrash()
    {
        await Login("clerk", "clerk123");
        await SeedPendingOrderAsync();

        var resp = await _c.GetAsync("/api/schedule/orders");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }
}
