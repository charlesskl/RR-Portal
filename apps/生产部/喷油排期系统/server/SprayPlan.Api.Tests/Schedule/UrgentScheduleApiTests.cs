using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 急单候选推荐：用隔离测试库造接近满产能的排期，验证候选筛选和安全拦截。
public class UrgentScheduleApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        await LoginAsync("clerk", "clerk123");
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task LoginAsync(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    private async Task<int> PrepareLineAsync(int limit = 100)
    {
        var lineId = 0;
        await _factory.WithDbAsync(async db =>
        {
            var line = db.ProductionLines.OrderBy(l => l.Id).First();
            line.Workshop = "兴信A";
            line.CraftType = "移印";
            line.DailyCapacityLimit = limit;
            lineId = line.Id;
            await db.SaveChangesAsync();
        });
        return lineId;
    }

    private async Task<int> AddOrderAsync(string no, string deliveryDate, bool urgent = false)
    {
        var id = 0;
        await _factory.WithDbAsync(async db =>
        {
            var now = DateTime.UtcNow;
            var order = new Order
            {
                ExternalOrderNo = no,
                OrderDate = DateTime.Parse("2026-07-01").ToUniversalTime(),
                DeliveryDate = DateTime.Parse(deliveryDate).ToUniversalTime(),
                Status = "scheduled",
                IsUrgent = urgent,
                CreatedBy = "test",
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            id = order.Id;
        });
        return id;
    }

    private async Task AddPlanAsync(int orderId, int lineId, string date, int qty, string status = "planned")
    {
        await _factory.WithDbAsync(async db =>
        {
            db.ProductionPlans.Add(new ProductionPlan
            {
                OrderId = orderId,
                LineId = lineId,
                PlanDate = DateTime.Parse(date).ToUniversalTime(),
                PlanType = "daily",
                ItemName = "兔子",
                PartName = "头",
                PlannedQty = qty,
                WorkerCount = 1,
                Status = status,
                CreatedBy = "test",
                CreatedAt = DateTime.UtcNow,
                LastModifiedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
    }

    private async Task<JsonElement> PreviewAsync(int urgentOrderId, int lineId, params (string date, int qty)[] rows)
    {
        var response = await _client.PostAsJsonAsync("/api/schedule/urgent/preview", new
        {
            urgentOrderId,
            rows = rows.Select((r, i) => new
            {
                lineId,
                planDate = r.date,
                plannedQty = r.qty,
                sourcePartId = i + 1,
                itemName = "急单件",
                partName = $"部位{i + 1}",
                workerCount = 1,
                machineNos = "[]",
            }).ToArray(),
        });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Preview_WhenCapacityEnough_AllowsDirectCommit()
    {
        var lineId = await PrepareLineAsync();
        var urgentId = await AddOrderAsync("URG-DIRECT", "2026-07-20", urgent: true);
        var normalId = await AddOrderAsync("NORMAL-LOW", "2026-07-20");
        await AddPlanAsync(normalId, lineId, "2026-07-10", 40);

        var result = await PreviewAsync(urgentId, lineId, ("2026-07-10", 30));

        Assert.True(result.GetProperty("canDirect").GetBoolean());
        Assert.Equal(0, result.GetProperty("overloads").GetArrayLength());
    }

    [Fact]
    public async Task Preview_WhenOverloaded_ReturnsOnlySafeStopCandidatesAsFit()
    {
        var lineId = await PrepareLineAsync();
        var urgentId = await AddOrderAsync("URG-OVER", "2026-07-20", urgent: true);
        var safeId = await AddOrderAsync("SAFE-CAND", "2026-07-15");
        var unsafeId = await AddOrderAsync("UNSAFE-CAND", "2026-07-11");
        var fillerId = await AddOrderAsync("FILLER", "2026-07-30");

        await AddPlanAsync(fillerId, lineId, "2026-07-10", 80);
        await AddPlanAsync(fillerId, lineId, "2026-07-11", 80);
        await AddPlanAsync(safeId, lineId, "2026-07-10", 10);
        await AddPlanAsync(safeId, lineId, "2026-07-11", 10);
        await AddPlanAsync(unsafeId, lineId, "2026-07-10", 5);
        await AddPlanAsync(unsafeId, lineId, "2026-07-11", 5);

        var result = await PreviewAsync(urgentId, lineId, ("2026-07-10", 20), ("2026-07-11", 20));
        var candidates = result.GetProperty("candidates").EnumerateArray().ToList();
        var safe = candidates.First(c => c.GetProperty("externalOrderNo").GetString() == "SAFE-CAND");
        var unsafeCand = candidates.First(c => c.GetProperty("externalOrderNo").GetString() == "UNSAFE-CAND");

        Assert.False(result.GetProperty("canDirect").GetBoolean());
        Assert.Equal(2, result.GetProperty("need").GetInt32());
        Assert.True(result.GetProperty("candidateEnough").GetBoolean());
        Assert.True(safe.GetProperty("fitToStop").GetBoolean());
        Assert.False(unsafeCand.GetProperty("fitToStop").GetBoolean());
        Assert.Contains("本次需顺延 2 天", unsafeCand.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Commit_RejectsPausedOrderThatWouldMissDelivery()
    {
        var lineId = await PrepareLineAsync();
        var urgentId = await AddOrderAsync("URG-BLOCK", "2026-07-20", urgent: true);
        var unsafeId = await AddOrderAsync("UNSAFE-BLOCK", "2026-07-11");
        await AddPlanAsync(unsafeId, lineId, "2026-07-10", 20);
        await AddPlanAsync(unsafeId, lineId, "2026-07-11", 20);

        var response = await _client.PostAsJsonAsync("/api/schedule/urgent/commit", new
        {
            urgentOrderId = urgentId,
            pausedOrderIds = new[] { unsafeId },
            rows = new[]
            {
                new { lineId, planDate = "2026-07-10", plannedQty = 20, sourcePartId = 1, itemName = "急单件", partName = "头", workerCount = 1, machineNos = "[]" },
                new { lineId, planDate = "2026-07-11", plannedQty = 20, sourcePartId = 2, itemName = "急单件", partName = "身", workerCount = 1, machineNos = "[]" },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("UNSAFE-BLOCK", body.GetProperty("error").GetString());
    }
}
