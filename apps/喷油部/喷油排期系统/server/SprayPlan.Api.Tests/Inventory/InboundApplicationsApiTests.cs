using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace SprayPlan.Api.Tests.Inventory;

public class InboundApplicationsApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        return Task.CompletedTask;
    }

    async Task LoginAsync() =>
        (await _client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();

    async Task<int> CreatePlanAsync()
    {
        var productResponse = await _client.PostAsJsonAsync("/api/products", new
        {
            productNo = "ERP-1001",
            parts = new[] { new { partName = "头", unitCost = 1, laborPrice = 1, paintCost = 1 } }
        });
        productResponse.EnsureSuccessStatusCode();
        var productId = (await productResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var product = await (await _client.GetAsync($"/api/products/{productId}")).Content.ReadFromJsonAsync<JsonElement>();
        var partId = product.GetProperty("parts")[0].GetProperty("id").GetInt32();

        var orderResponse = await _client.PostAsJsonAsync("/api/orders", new
        {
            externalOrderNo = "ERP-ORDER-1", productId,
            partQtys = new[] { new { partName = "头", sourcePartId = partId, qty = 200 } }
        });
        orderResponse.EnsureSuccessStatusCode();
        var orderId = (await orderResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        (await _client.PostAsJsonAsync("/api/plans", new
        {
            plans = new[] { new { planDate = "2026-09-09", lineId = 1, orderId, itemName = "兔子", partName = "头", sourcePartId = partId, plannedQty = 200 } }
        })).EnsureSuccessStatusCode();
        var plans = await (await _client.GetAsync($"/api/plans?orderId={orderId}")).Content.ReadFromJsonAsync<JsonElement>();
        return plans[0].GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task InboundChange_AutomaticallyCreatesDeltaApplications()
    {
        await LoginAsync();
        var planId = await CreatePlanAsync();
        (await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 200, inboundQty = 80 })).EnsureSuccessStatusCode();
        (await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { inboundQty = 80 })).EnsureSuccessStatusCode();
        (await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { inboundQty = 100 })).EnsureSuccessStatusCode();

        var page = await (await _client.GetAsync("/api/inventory/inbound-applications")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, page.GetProperty("total").GetInt32());
        var items = page.GetProperty("items");
        Assert.Equal(new[] { 20, 80 }, items.EnumerateArray().Select(x => x.GetProperty("quantity").GetInt32()).ToArray());
        Assert.All(items.EnumerateArray(), item =>
        {
            Assert.Equal("ERP-ORDER-1", item.GetProperty("orderNo").GetString());
            Assert.Equal("ERP-1001", item.GetProperty("productNo").GetString());
        });
    }

    [Fact]
    public async Task ErpEndpoints_AreReadOnlyAndAvailableWithoutLogin()
    {
        await LoginAsync();
        var planId = await CreatePlanAsync();
        (await _client.PatchAsJsonAsync($"/api/plans/{planId}", new { goodQty = 100, inboundQty = 60 })).EnsureSuccessStatusCode();
        _client.Dispose();
        _client = _factory.CreateClient();

        var listResponse = await _client.GetAsync("/api/erp/inbound-applications");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var page = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        var applicationNo = page.GetProperty("items")[0].GetProperty("applicationNo").GetString();
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync($"/api/erp/inbound-applications/{applicationNo}")).StatusCode);
    }

    // 回归：生产库沿用 prisma 时代的 INTEGER Unix 毫秒日期格式，
    // 直接插入 INTEGER ms 的行也必须能正常读出（曾因此整页 500）。
    [Fact]
    public async Task List_ToleratesLegacyIntegerMillisecondDates()
    {
        await LoginAsync();
        var ms = new DateTimeOffset(2026, 9, 14, 6, 37, 41, TimeSpan.Zero).ToUnixTimeMilliseconds();
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO inbound_applications
                (applicationNo, sourcePlanId, factoryId, productionDate, orderNo, productNo,
                 itemName, partName, quantity, createdBy, createdAt, updatedAt, updatedBy, remark)
            VALUES ({0}, 1, 'XINGXIN', {1}, 'ERP-ORDER-LEGACY', 'ERP-1001',
                    '兔子', '头', 10, 'clerk', {1}, {1}, NULL, NULL)
            """, "RK-LEGACY-1", ms));

        var response = await _client.GetAsync("/api/inventory/inbound-applications");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var page = await response.Content.ReadFromJsonAsync<JsonElement>();
        var item = page.GetProperty("items").EnumerateArray()
            .Single(x => x.GetProperty("applicationNo").GetString() == "RK-LEGACY-1");
        Assert.Equal(10, item.GetProperty("quantity").GetInt32());
        Assert.Equal("2026-09-14T06:37:41Z", item.GetProperty("updatedAt").GetString());
    }
}
