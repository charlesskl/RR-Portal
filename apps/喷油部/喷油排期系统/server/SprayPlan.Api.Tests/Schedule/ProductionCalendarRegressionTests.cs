using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests.Schedule;

public class ProductionCalendarRegressionTests
{
    static DateTime NextMonday()
    {
        var day = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date.AddDays(10), DateTimeKind.Utc);
        while (day.DayOfWeek != DayOfWeek.Monday) day = day.AddDays(1);
        return day;
    }

    static async Task SeedBothFactories(AppDbContext db, DateTime day)
    {
        var line = new ProductionLine { Name = "华登拉", Workshop = "华登A", FactoryId = "HUADENG" };
        var xingxin = new Order { ExternalOrderNo = "XINGXIN-CALENDAR", Status = "scheduled", FactoryId = "XINGXIN", OrderDate = day };
        var huadeng = new Order { ExternalOrderNo = "HUADENG-CALENDAR", Status = "scheduled", FactoryId = "HUADENG", OrderDate = day };
        db.ProductionLines.Add(line); db.Orders.AddRange(xingxin, huadeng); await db.SaveChangesAsync();
        db.ProductionPlans.AddRange(
            new ProductionPlan { OrderId = xingxin.Id, LineId = 1, FactoryId = "XINGXIN", PartName = "头", PlanDate = day, PlannedQty = 10 },
            new ProductionPlan { OrderId = huadeng.Id, LineId = line.Id, FactoryId = "HUADENG", PartName = "头", PlanDate = day, PlannedQty = 10 });
        await db.SaveChangesAsync();
    }

    static Task<HttpResponseMessage> ChangeHoliday(HttpClient client, string operation, DateTime day, int id) => operation switch
    {
        "create" => client.PostAsJsonAsync("/api/holidays", new { date = ScheduleCalc.Ymd(day), type = "holiday" }),
        "update" => client.PatchAsJsonAsync($"/api/holidays/{id}", new { type = "holiday" }),
        _ => client.DeleteAsync($"/api/holidays/{id}")
    };

    [Fact]
    public async Task Patch_UnchangedRestDateAllowsActualsButChangingToRestDateDoesNot()
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync();
        var sunday = NextMonday().AddDays(-1); var id = 0;
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "LEGACY-SUNDAY", Status = "scheduled", OrderDate = sunday };
            db.Orders.Add(order); await db.SaveChangesAsync();
            var plan = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = sunday, PlannedQty = 10 };
            db.ProductionPlans.Add(plan); await db.SaveChangesAsync(); id = plan.Id;
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var response = await client.PatchAsJsonAsync($"/api/plans/{id}", new { planDate = ScheduleCalc.Ymd(sunday), goodQty = 0, remark = "历史补录" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await factory.WithDbAsync(async db => {
            var plan = await db.ProductionPlans.FindAsync(id);
            Assert.Equal(0, plan!.GoodQty); Assert.Equal(sunday, plan.PlanDate); Assert.Equal("历史补录", plan.Remark);
        });
    }

    [Fact]
    public async Task MonthlyCommit_RejectsStaleHolidayDraftBeforeRebuildRemovesAnyPlans()
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync();
        var monday = NextMonday(); var orderId = 0;
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "STALE-DRAFT", Status = "scheduled", OrderDate = monday };
            db.Orders.Add(order); await db.SaveChangesAsync(); orderId = order.Id;
            db.Holidays.Add(new Holiday { Date = monday, Type = "holiday" });
            db.ProductionPlans.Add(new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = monday.AddDays(1), PlannedQty = 10 });
            await db.SaveChangesAsync();
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync("/api/schedule/auto/commit", new {
            month = monday.ToString("yyyy-MM"), mode = "rebuild", draft = new[] {
                new { orderId, externalOrderNo = "STALE-DRAFT", productNo = "TEST", sourcePartId = 1, itemName = "", partName = "头",
                    planDate = ScheduleCalc.Ymd(monday), plannedQty = 10, orderDate = ScheduleCalc.Ymd(monday), deliveryDate = (string?)null,
                    lineId = 1, lineName = "胡旗拉", stepNo = 1, craft = "移印" }
            }
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.ToListAsync(); Assert.Single(plans);
            Assert.Null(plans[0].DeletedAt); Assert.Equal(monday.AddDays(1), plans[0].PlanDate);
        });
    }

    [Theory]
    [InlineData("good")]
    [InlineData("inbound")]
    [InlineData("reported")]
    [InlineData("recorded")]
    public async Task Reflow_DoesNotMovePlanOntoProtectedActualInSameChain(string kind)
    {
        using var factory = new ApiFactory(); await factory.SeedAsync(); var monday = NextMonday();
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "LOCKED-DAY", Status = "in_production", OrderDate = monday };
            db.Orders.Add(order); await db.SaveChangesAsync();
            var pending = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = monday, PlannedQty = 10 };
            var recorded = new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = monday.AddDays(1), PlannedQty = 10 };
            if (kind == "good") recorded.GoodQty = 0;
            if (kind == "inbound") recorded.InboundQty = 0;
            if (kind == "reported") recorded.ReportedQty = 0;
            if (kind == "recorded") recorded.Status = "recorded";
            db.ProductionPlans.AddRange(pending, recorded); db.Holidays.Add(new Holiday { Date = monday, Type = "holiday" }); await db.SaveChangesAsync();
            Assert.Equal(1, await ProductionCalendar.Reflow(db, "tester"));
            Assert.Equal(monday.AddDays(2), pending.PlanDate); Assert.Equal(monday.AddDays(1), recorded.PlanDate);
            // 只断言已录行自身字段，订单头因未录行顺延而更新是预期行为。
            Assert.Equal(kind == "good" ? 0 : null, recorded.GoodQty);
            Assert.Equal(kind == "inbound" ? 0 : null, recorded.InboundQty);
            Assert.Equal(kind == "reported" ? 0 : null, recorded.ReportedQty);
            Assert.Equal("[]", recorded.ModificationHistory); Assert.Null(recorded.LastModifiedBy);
        });
    }

    [Fact]
    public async Task Reflow_PreservesPreexistingSameDayActualAndPendingRows()
    {
        using var factory = new ApiFactory(); await factory.SeedAsync(); var day = NextMonday();
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "SAME-DAY", Status = "in_production", OrderDate = day };
            db.Orders.Add(order); await db.SaveChangesAsync();
            db.ProductionPlans.AddRange(
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 10 },
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 10, GoodQty = 0 });
            await db.SaveChangesAsync(); Assert.Equal(0, await ProductionCalendar.Reflow(db, "tester"));
            Assert.All(await db.ProductionPlans.ToListAsync(), p => { Assert.Equal(day, p.PlanDate); Assert.Equal("[]", p.ModificationHistory); });
        });
    }

    [Fact]
    public async Task Reflow_PreservesHistoryDeletedCompletedArchivedAndNeverMovesEarlierWhenWorkdayRestored()
    {
        using var factory = new ApiFactory(); await factory.SeedAsync(); var day = NextMonday();
        await factory.WithDbAsync(async db => {
            var active = new Order { ExternalOrderNo = "ACTIVE-CALENDAR", Status = "scheduled", OrderDate = day };
            var complete = new Order { ExternalOrderNo = "COMPLETE-CALENDAR", Status = "completed", OrderDate = day };
            var archived = new Order { ExternalOrderNo = "ARCHIVE-CALENDAR", Status = "archived", OrderDate = day };
            db.Orders.AddRange(active, complete, archived); await db.SaveChangesAsync();
            var old = new ProductionPlan { OrderId = active.Id, LineId = 1, PartName = "历史", PlanDate = DateTime.UtcNow.Date.AddDays(-2), PlannedQty = 11 };
            var deleted = new ProductionPlan { OrderId = active.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 12, DeletedAt = DateTime.UtcNow };
            var finished = new ProductionPlan { OrderId = complete.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 13 };
            var voided = new ProductionPlan { OrderId = archived.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 14 };
            var movable = new ProductionPlan { OrderId = active.Id, LineId = 1, PartName = "头", PlanDate = day, PlannedQty = 15, WorkerCount = 3, GroupNo = 7, MachineNos = "[\"5#\"]", ModificationHistory = "[{\"reason\":\"既有记录\"}]" };
            db.ProductionPlans.AddRange(old, deleted, finished, voided, movable);
            var holiday = new Holiday { Date = day, Type = "holiday" }; db.Holidays.Add(holiday); await db.SaveChangesAsync();
            Assert.Equal(1, await ProductionCalendar.Reflow(db, "tester"));
            Assert.Equal(day.AddDays(1), movable.PlanDate); Assert.Equal(15, movable.PlannedQty); Assert.Equal(3, movable.WorkerCount); Assert.Equal(7, movable.GroupNo); Assert.Equal("[\"5#\"]", movable.MachineNos);
            var audit = JsonSerializer.Deserialize<List<JsonElement>>(movable.ModificationHistory)!; Assert.Equal(2, audit.Count); Assert.Equal("既有记录", audit[0].GetProperty("reason").GetString());
            Assert.All(new[] { deleted, finished, voided }, p => { Assert.Equal(day, p.PlanDate); Assert.Equal("[]", p.ModificationHistory); }); Assert.Equal("[]", old.ModificationHistory);
            var history = movable.ModificationHistory; holiday.Type = "workday"; await db.SaveChangesAsync();
            Assert.Equal(0, await ProductionCalendar.Reflow(db, "tester")); Assert.Equal(day.AddDays(1), movable.PlanDate); Assert.Equal(history, movable.ModificationHistory);
        });
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("delete")]
    public async Task HolidaySave_ReflowsBothFactoriesBecauseCalendarIsShared(string operation)
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync();
        var day = operation == "delete" ? NextMonday().AddDays(-1) : NextMonday(); var holidayId = 0;
        await factory.WithDbAsync(async db => {
            await SeedBothFactories(db, day);
            if (operation != "create") { var holiday = new Holiday { Date = day, Type = "workday" }; db.Holidays.Add(holiday); await db.SaveChangesAsync(); holidayId = holiday.Id; }
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var response = await ChangeHoliday(client, operation, day, holidayId); response.EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.OrderBy(p => p.Id).ToListAsync(); Assert.Equal(2, plans.Count);
            Assert.All(plans, plan => { Assert.Equal(day.AddDays(1), plan.PlanDate); Assert.Equal("clerk", plan.LastModifiedBy); Assert.Contains("planDate", plan.ModificationHistory); });
            Assert.Equal(new[] { "XINGXIN", "HUADENG" }, plans.Select(p => p.FactoryId));
        });
        var visiblePlans = await client.GetFromJsonAsync<JsonElement>("/api/plans"); Assert.Equal(1, visiblePlans.GetArrayLength());
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("delete")]
    public async Task HolidaySave_SecondFactoryFailureRollsBackCalendarAndBothFactories(string operation)
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync();
        var day = operation == "delete" ? NextMonday().AddDays(-1) : NextMonday(); var holidayId = 0; string before = "";
        async Task<string> Snapshot(AppDbContext db) => JsonSerializer.Serialize(new {
            holidays = await db.Holidays.AsNoTracking().OrderBy(h => h.Id).ToListAsync(),
            plans = await db.ProductionPlans.AsNoTracking().OrderBy(p => p.Id).ToListAsync(),
            orders = await db.Orders.AsNoTracking().OrderBy(o => o.Id).ToListAsync()
        });
        await factory.WithDbAsync(async db => {
            await SeedBothFactories(db, day);
            if (operation != "create") { var holiday = new Holiday { Date = day, Type = "workday" }; db.Holidays.Add(holiday); await db.SaveChangesAsync(); holidayId = holiday.Id; }
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_calendar_reflow BEFORE UPDATE ON production_plans WHEN OLD.factoryId = 'HUADENG' BEGIN SELECT RAISE(ABORT, 'simulated second factory failure'); END;");
            db.ChangeTracker.Clear(); before = await Snapshot(db);
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.InternalServerError, (await ChangeHoliday(client, operation, day, holidayId)).StatusCode);
        await factory.WithDbAsync(async db => Assert.Equal(before, await Snapshot(db)));
    }

    [Fact]
    public async Task ManualReflow_RemainsInCurrentFactoryAndDoesNotExposeOtherFactoryPlans()
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync(); var day = NextMonday();
        await factory.WithDbAsync(async db => { await SeedBothFactories(db, day); db.Holidays.Add(new Holiday { Date = day, Type = "holiday" }); await db.SaveChangesAsync(); });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var result = await (await client.PostAsJsonAsync("/api/holidays/reflow", new { })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, result.GetProperty("adjustedPlans").GetInt32());
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.OrderBy(p => p.Id).ToListAsync();
            Assert.Equal(day.AddDays(1), plans.Single(p => p.FactoryId == "XINGXIN").PlanDate);
            Assert.Equal(day, plans.Single(p => p.FactoryId == "HUADENG").PlanDate);
        });
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>("/api/plans")).GetArrayLength());
    }

    [Fact]
    public async Task Viewer_CannotChangeSharedCalendarOrReflow()
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient(); await factory.SeedAsync(); var day = NextMonday(); var id = 0;
        await factory.WithDbAsync(async db => { var holiday = new Holiday { Date = day, Type = "workday" }; db.Holidays.Add(holiday); await db.SaveChangesAsync(); id = holiday.Id; });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "viewer", password = "viewer123" })).EnsureSuccessStatusCode();
        foreach (var operation in new[] { "create", "update", "delete" }) Assert.Equal(HttpStatusCode.Forbidden, (await ChangeHoliday(client, operation, day, id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/holidays/reflow", new { })).StatusCode);
        await factory.WithDbAsync(async db => Assert.Equal("workday", (await db.Holidays.SingleAsync()).Type));
    }
}
