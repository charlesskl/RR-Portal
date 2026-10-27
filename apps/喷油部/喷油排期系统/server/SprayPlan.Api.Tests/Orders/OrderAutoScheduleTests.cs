using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Orders;

public class OrderAutoScheduleTests : IAsyncLifetime
{
    private ApiFactory factory = null!;
    private HttpClient client = null!;
    private int orderId, headId, firstLine, secondLine;
    private readonly DateTime today = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date, DateTimeKind.Utc);
    private string protectedSnapshot = "", inventory = "";
    public async Task InitializeAsync()
    {
        factory = new ApiFactory(); client = factory.CreateClient(); await factory.SeedAsync();
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "AUTO-DEMAND", Parts = new() { new() { PartName = "头" }, new() { PartName = "脚" } } };
            db.Products.Add(product);
            var line = await db.ProductionLines.FirstAsync(); line.DailyCapacityLimit = 100; firstLine = line.Id;
            var nextLine = new ProductionLine { Name = "第二工序拉", DailyCapacityLimit = 100 };
            db.ProductionLines.Add(nextLine); await db.SaveChangesAsync(); secondLine = nextLine.Id;
            var order = new Order { ExternalOrderNo = "AUTO-1", ProductId = product.Id, Status = "in_production",
                PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 50 } } };
            db.Orders.Add(order); await db.SaveChangesAsync(); orderId = order.Id; headId = order.PartQtys[0].Id;
            ProductionPlan Plan(string part, int step, int qty, int? good) => new() {
                OrderId = orderId, PartName = part, StepNo = step, LineId = step == 1 ? firstLine : secondLine,
                PlanDate = good.HasValue ? today.AddDays(-2) : new ProductionCalendar([]).NextWorkday(today.AddDays(1)),
                PlannedQty = qty, GoodQty = good, InboundQty = good.HasValue ? Math.Min(good.Value, 30) : null,
                ReportedQty = good, ProductionValue = good * 2, Status = good.HasValue ? "recorded" : "planned",
                CreatedBy = "original", ModificationHistory = "[]"
            };
            db.ProductionPlans.AddRange(Plan("头", 1, 60, 60), Plan("头", 1, 40, null),
                Plan("头", 2, 60, 40), Plan("头", 2, 40, null), Plan("脚", 1, 50, 50));
            await db.SaveChangesAsync();
            var source = await db.ProductionPlans.FirstAsync(plan => plan.OrderId == orderId && plan.PartName == "脚");
            db.InboundApplications.Add(new() { ApplicationNo = "KEEP-INBOUND", SourcePlanId = source.Id, Quantity = 30 });
            db.InventoryMoves.Add(new() { ProductId = product.Id, OwnerOrderId = orderId, PartName = "脚", Delta = -2, Reason = "assembly_pickup" });
            await db.SaveChangesAsync();
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        protectedSnapshot = await Snapshot(true); inventory = await client.GetStringAsync("/api/inventory/query");
    }
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    private Task<HttpResponseMessage> Save(int qty, bool auto = true) => client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys = new[] { new { id = headId, qty } }, autoAdjustSchedule = auto });
    private async Task<string> Snapshot(bool protectedOnly = false)
    {
        var snapshot = "";
        await factory.WithDbAsync(async db => {
            var rows = await db.ProductionPlans.AsNoTracking().OrderBy(plan => plan.Id).ToListAsync();
            snapshot = JsonSerializer.Serialize(new {
                Plans = protectedOnly ? rows.Where(plan => PlanDateRules.HasActuals(plan) || plan.PartName != "头").ToList() : rows,
                Moves = await db.InventoryMoves.AsNoTracking().OrderBy(move => move.Id).ToListAsync(),
                Inbound = await db.InboundApplications.AsNoTracking().OrderBy(app => app.Id).ToListAsync()
            });
        });
        return snapshot;
    }
    private async Task AssertHistoryUnchanged()
    {
        Assert.Equal(protectedSnapshot, await Snapshot(true));
        Assert.Equal(inventory, await client.GetStringAsync("/api/inventory/query"));
    }

    [Fact]
    public async Task Increase_AutomaticallyFillsEveryStep_PreservesHistory_AndIsIdempotent()
    {
        var response = await Save(120); response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(60, body.GetProperty("scheduleAdjustment").GetProperty("addedQty").GetInt32());
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/orders/{orderId}");
        Assert.All(detail.GetProperty("scheduleBalances").EnumerateArray(), row => {
            Assert.Equal(0, row.GetProperty("supplementQty").GetInt32()); Assert.Equal(0, row.GetProperty("reduceQty").GetInt32());
        });
        await factory.WithDbAsync(async db => {
            var added = await db.ProductionPlans.Where(plan => plan.OrderId == orderId && plan.CreatedBy == "clerk").ToListAsync();
            Assert.All(added, plan => { Assert.True(plan.PlanDate >= today); Assert.Contains("demand_supplement", plan.ModificationHistory); Assert.Null(plan.GoodQty); Assert.Null(plan.InboundQty); });
            foreach (var downstream in added.Where(plan => plan.StepNo == 2)) {
                var all = await db.ProductionPlans.Where(plan => plan.OrderId == orderId && plan.PartName == "头" && plan.DeletedAt == null).ToListAsync();
                var upstream = all.Where(plan => plan.StepNo == 1 && plan.PlanDate < downstream.PlanDate).Sum(plan => plan.GoodQty ?? plan.PlannedQty);
                var downstreamTotal = all.Where(plan => plan.StepNo == 2 && plan.PlanDate <= downstream.PlanDate).Sum(plan => plan.GoodQty ?? plan.PlannedQty);
                Assert.True(downstreamTotal <= upstream);
            }
        });
        await AssertHistoryUnchanged();
        var snapshot = await Snapshot();
        (await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { autoAdjustSchedule = true })).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await Snapshot());
    }

    [Fact]
    public async Task Decrease_TrimsLatestUnreportedPlansAndSoftDeletes_ActualsRemain()
    {
        (await Save(80)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => Assert.Equal(20, (await db.ProductionPlans.SingleAsync(plan => plan.OrderId == orderId && plan.StepNo == 1 && plan.PartName == "头" && plan.GoodQty == null)).PlannedQty));
        var response = await Save(30); response.EnsureSuccessStatusCode();
        Assert.Equal("completed", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        await factory.WithDbAsync(async db => {
            var pending = await db.ProductionPlans.Where(plan => plan.OrderId == orderId && plan.PartName == "头" && plan.GoodQty == null).ToListAsync();
            Assert.All(pending, plan => { Assert.NotNull(plan.DeletedAt); Assert.Equal("clerk", plan.DeletedBy); Assert.Contains("demand_reduce", plan.ModificationHistory); });
        });
        await AssertHistoryUnchanged();
    }

    [Fact]
    public async Task Supplement_SkipsHolidayMachineConflictAndOtherOrderLineCapacity()
    {
        var lastDay = new ProductionCalendar([]).NextWorkday(today.AddDays(1));
        var candidate = new ProductionCalendar([]).NextWorkday(lastDay.AddDays(1));
        var holiday = new ProductionCalendar([]).NextWorkday(candidate.AddDays(1));
        await factory.WithDbAsync(async db => {
            foreach (var plan in await db.ProductionPlans.Where(plan => plan.OrderId == orderId && plan.StepNo == 1 && plan.PartName == "头").ToListAsync()) plan.MachineNos = "[\"5#\"]";
            var other = new Order { ExternalOrderNo = "OTHER-LOAD" }; db.Orders.Add(other); await db.SaveChangesAsync();
            db.ProductionPlans.Add(new() { OrderId = other.Id, LineId = firstLine, PartName = "其他单", PlanDate = candidate, MachineNos = "[\"5#\"]", PlannedQty = 90 });
            db.Holidays.Add(new() { Date = holiday, Type = "holiday", Remark = "测试休假" }); await db.SaveChangesAsync();
        });
        protectedSnapshot = await Snapshot(true);
        (await Save(180)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var rows = await db.ProductionPlans.Where(plan => plan.DeletedAt == null).ToListAsync();
            var added = rows.Where(plan => plan.CreatedBy == "clerk" && plan.LineId == firstLine).ToList();
            Assert.NotEmpty(added);
            Assert.All(added, plan => { Assert.NotEqual(candidate, plan.PlanDate); Assert.NotEqual(holiday, plan.PlanDate); Assert.NotEqual(DayOfWeek.Sunday, plan.PlanDate.DayOfWeek); Assert.Equal("[\"5#\"]", plan.MachineNos); });
            foreach (var day in rows.Where(plan => plan.PlanDate >= candidate).GroupBy(plan => new { plan.LineId, plan.PlanDate })) Assert.True(day.Sum(plan => plan.PlannedQty) <= 100);
        });
        await AssertHistoryUnchanged();
    }

    [Fact]
    public async Task InsufficientCapacity_RollsBackQuantityAndAllPlanChanges()
    {
        await factory.WithDbAsync(async db => { foreach (var line in await db.ProductionLines.ToListAsync()) line.DailyCapacityLimit = 1; await db.SaveChangesAsync(); });
        var before = await Snapshot();
        var response = await Save(2000);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("本次修改未保存", await response.Content.ReadAsStringAsync());
        Assert.Equal(before, await Snapshot());
        await factory.WithDbAsync(async db => Assert.Equal(100, (await db.OrderPartQtys.SingleAsync(part => part.Id == headId)).Qty));
    }

    [Fact]
    public async Task DisabledDownstreamLine_IsReportedWithoutInventingAnotherLine()
    {
        await factory.WithDbAsync(async db => { (await db.ProductionLines.SingleAsync(line => line.Id == secondLine)).IsActive = false; await db.SaveChangesAsync(); });
        var response = await Save(120); response.EnsureSuccessStatusCode();
        Assert.Contains("原拉别已停用", await response.Content.ReadAsStringAsync());
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(plan => plan.CreatedBy == "clerk" && plan.LineId == secondLine)));
        await AssertHistoryUnchanged();
    }

    [Fact]
    public async Task MissingInitialSchedule_ReportsConfigurationNeeded()
    {
        var tailId = 0;
        await factory.WithDbAsync(async db => { var part = new OrderPartQty { OrderId = orderId, PartName = "尾", Qty = 0 }; db.OrderPartQtys.Add(part); await db.SaveChangesAsync(); tailId = part.Id; });
        var before = await Snapshot();
        var response = await client.PatchAsJsonAsync($"/api/orders/{orderId}", new { partQtys = new[] { new { id = tailId, qty = 100 } }, autoAdjustSchedule = true });
        response.EnsureSuccessStatusCode(); Assert.Contains("请先生成首次排期", await response.Content.ReadAsStringAsync());
        Assert.Equal(before, await Snapshot());
    }

    [Theory]
    [InlineData("reported")]
    [InlineData("inbound")]
    [InlineData("recorded")]
    [InlineData("application")]
    public async Task EveryActualOrInboundMarker_IsProtected(string marker)
    {
        var protectedId = 0;
        await factory.WithDbAsync(async db => {
            var plan = new ProductionPlan { OrderId = orderId, PartName = "头", StepNo = 1, LineId = firstLine, PlanDate = today.AddDays(5), PlannedQty = 10 };
            if (marker == "reported") plan.ReportedQty = 0;
            if (marker == "inbound") plan.InboundQty = 0;
            if (marker == "recorded") plan.Status = "recorded";
            db.ProductionPlans.Add(plan); await db.SaveChangesAsync(); protectedId = plan.Id;
            if (marker == "application") { db.InboundApplications.Add(new() { ApplicationNo = "APP-ONLY", SourcePlanId = plan.Id, Quantity = 1 }); await db.SaveChangesAsync(); }
        });
        (await Save(30)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var plan = await db.ProductionPlans.SingleAsync(plan => plan.Id == protectedId);
            Assert.Equal(10, plan.PlannedQty); Assert.Null(plan.DeletedAt); Assert.Equal("[]", plan.ModificationHistory);
        });
    }

    [Fact]
    public async Task OptOut_PreservesOriginalPlans()
    {
        var before = await Snapshot(); (await Save(120, false)).EnsureSuccessStatusCode(); Assert.Equal(before, await Snapshot());
    }
}
