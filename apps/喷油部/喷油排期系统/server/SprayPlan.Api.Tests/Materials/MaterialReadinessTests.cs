using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests.Materials;

public class MaterialReadinessTests : IAsyncLifetime
{
    private ApiFactory factory = null!;
    private HttpClient client = null!;
    private int orderA, orderB, lineId;
    private string actuals = "", inventory = "";
    private readonly DateTime today = MaterialReflow.Today;
    private string Ymd(DateTime day) => day.ToString("yyyy-MM-dd");
    private DateTime Work(DateTime day) => new ProductionCalendar([]).NextWorkday(day);
    public async Task InitializeAsync()
    {
        factory = new ApiFactory(); client = factory.CreateClient(); await factory.SeedAsync();
        await factory.WithDbAsync(async db => {
            var line = await db.ProductionLines.FirstAsync(); line.DailyCapacityLimit = 100; lineId = line.Id;
            var product = new Product { ProductNo = "MATERIAL", Parts = new() { new() { PartName = "A" }, new() { PartName = "B" } } };
            db.Products.Add(product); await db.SaveChangesAsync();
            var a = new Order { ExternalOrderNo = "MATERIAL-A", ProductId = product.Id, Status = "in_production", DeliveryDate = today.AddDays(10), PartQtys = new() { new() { PartName = "A", Qty = 100 } } };
            var b = new Order { ExternalOrderNo = "MATERIAL-B", ProductId = product.Id, Status = "scheduled", DeliveryDate = today.AddDays(12), PartQtys = new() { new() { PartName = "B", Qty = 80 } } };
            db.Orders.AddRange(a, b); await db.SaveChangesAsync(); orderA = a.Id; orderB = b.Id;
            var actual = new ProductionPlan { OrderId = orderA, LineId = lineId, PartName = "A", PlannedQty = 20, GoodQty = 20, ReportedQty = 20, InboundQty = 10,
                ProductionValue = 88, Status = "recorded", PlanDate = today.AddDays(-1), CreatedBy = "original" };
            db.ProductionPlans.AddRange(actual,
                new() { OrderId = orderA, LineId = lineId, PartName = "A", PlannedQty = 80, PlanDate = Work(today), CreatedBy = "original" },
                new() { OrderId = orderB, LineId = lineId, PartName = "B", PlannedQty = 80, PlanDate = Work(today.AddDays(5)), CreatedBy = "original" });
            await db.SaveChangesAsync();
            db.InboundApplications.Add(new() { ApplicationNo = "MAT-INBOUND", SourcePlanId = actual.Id, Quantity = 10 });
            db.InventoryMoves.Add(new() { ProductId = product.Id, OwnerOrderId = orderA, PartName = "A", Delta = -2, Reason = "assembly_pickup" });
            await db.SaveChangesAsync();
        });
        await Login("clerk", "clerk123"); actuals = await Snapshot(true); inventory = await client.GetStringAsync("/api/inventory/query");
    }
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    private async Task Login(string username, string password) => (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
    private async Task<JsonElement> Row(int order) => (await client.GetFromJsonAsync<JsonElement>($"/api/materials?orderId={order}"))[0];
    private async Task<HttpResponseMessage> Save(int order, int qty, string? expected = null, string? actual = null)
    {
        var row = await Row(order);
        return await client.PutAsJsonAsync("/api/materials", new { orderId = order, partName = order == orderA ? "A" : "B", arrivedQty = qty,
            expectedDate = expected, actualDate = actual, remark = "", version = row.GetProperty("version").GetInt32() });
    }
    private async Task<string> Snapshot(bool onlyActuals = false)
    {
        var result = "";
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.AsNoTracking().OrderBy(plan => plan.Id).ToListAsync();
            result = JsonSerializer.Serialize(new {
                Plans = onlyActuals ? plans.Where(PlanDateRules.HasActuals).ToList() : plans,
                Materials = onlyActuals ? null : await db.OrderMaterials.AsNoTracking().OrderBy(material => material.Id).ToListAsync(),
                Moves = await db.InventoryMoves.AsNoTracking().OrderBy(move => move.Id).ToListAsync(),
                Applications = await db.InboundApplications.AsNoTracking().OrderBy(app => app.Id).ToListAsync()
            });
        }); return result;
    }
    private async Task AssertActuals()
    {
        Assert.Equal(actuals, await Snapshot(true)); Assert.Equal(inventory, await client.GetStringAsync("/api/inventory/query"));
    }

    [Fact]
    public async Task UnregisteredLegacyPlans_AreUnchangedByReadingMaterials()
    {
        var before = await Snapshot(); Assert.Equal("未登记", (await Row(orderA)).GetProperty("status").GetString()); Assert.Equal(before, await Snapshot());
    }

    [Fact]
    public async Task MissingMaterial_ReleasesCapacity_AndCanBeRestoredFromSavedConfiguration()
    {
        (await Save(orderA, 20)).EnsureSuccessStatusCode();
        var row = await Row(orderA); Assert.Equal(80, row.GetProperty("waitingQty").GetInt32()); Assert.Equal("待料", row.GetProperty("status").GetString());
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null)));
        (await Save(orderA, 100, actual: Ymd(today))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var pending = await db.ProductionPlans.Where(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null).ToListAsync();
            Assert.Equal(80, pending.Sum(plan => plan.PlannedQty)); Assert.All(pending, plan => Assert.Equal(Work(today), plan.PlanDate));
        });
        await AssertActuals();
    }

    [Fact]
    public async Task PartialArrival_OnlySchedulesAvailableQuantity_WithoutInventingRest()
    {
        (await Save(orderA, 50, actual: Ymd(today))).EnsureSuccessStatusCode();
        var row = await Row(orderA); Assert.Equal(50, row.GetProperty("waitingQty").GetInt32()); Assert.Equal("部分到料", row.GetProperty("status").GetString());
        await factory.WithDbAsync(async db => Assert.Equal(30, await db.ProductionPlans.Where(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null).SumAsync(plan => plan.PlannedQty)));
        await AssertActuals();
    }

    [Fact]
    public async Task LateMaterial_PushesPlansBack_ReadyMaterialFillsVacatedCapacity()
    {
        (await Save(orderB, 80, actual: Ymd(today))).EnsureSuccessStatusCode();
        var expected = Work(today.AddDays(3));
        (await Save(orderA, 20, Ymd(expected))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var a = await db.ProductionPlans.Where(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null).ToListAsync();
            Assert.All(a, plan => Assert.True(plan.PlanDate >= expected)); Assert.Equal(80, a.Sum(plan => plan.PlannedQty));
            var b = await db.ProductionPlans.Where(plan => plan.OrderId == orderB && plan.DeletedAt == null).ToListAsync();
            Assert.Equal(80, b.Where(plan => plan.PlanDate == Work(today)).Sum(plan => plan.PlannedQty));
            var all = await db.ProductionPlans.Where(plan => plan.DeletedAt == null && plan.PlanDate >= today).ToListAsync();
            Assert.All(all.GroupBy(plan => plan.PlanDate), day => Assert.True(day.Sum(plan => plan.PlannedQty) <= 100));
        });
        await AssertActuals();
    }

    [Fact]
    public async Task OverdueExpectedArrival_IsRecheckedWithoutBrowser_OnlyOncePerDay()
    {
        (await Save(orderA, 20, Ymd(Work(today.AddDays(3))))).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var record = await db.OrderMaterials.SingleAsync(material => material.OrderId == orderA);
            record.ExpectedDate = today.AddDays(-1); record.LastReflowDate = today.AddDays(-1); await db.SaveChangesAsync();
            await MaterialReflowWorker.ReflowDue(db, "XINGXIN");
        });
        Assert.Equal("到料逾期", (await Row(orderA)).GetProperty("status").GetString());
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null)));
        var before = await Snapshot();
        await factory.WithDbAsync(async db => Assert.Null(await MaterialReflowWorker.ReflowDue(db, "XINGXIN")));
        Assert.Equal(before, await Snapshot()); await AssertActuals();
    }

    [Fact]
    public async Task Reflow_RespectsWorkCalendarAndPreviousStepSupply()
    {
        var secondLine = 0;
        await factory.WithDbAsync(async db => {
            var line = new ProductionLine { Name = "后工序", DailyCapacityLimit = 100 }; db.ProductionLines.Add(line); await db.SaveChangesAsync(); secondLine = line.Id;
            db.ProductionPlans.Add(new() { OrderId = orderA, LineId = secondLine, PartName = "A", StepNo = 2, PlannedQty = 100, PlanDate = Work(today.AddDays(4)) });
            db.Holidays.Add(new() { Date = today, Type = "holiday" }); await db.SaveChangesAsync();
        });
        (await Save(orderA, 100)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(plan => plan.OrderId == orderA && plan.DeletedAt == null).ToListAsync();
            var generated = plans.Where(plan => plan.GoodQty == null).ToList();
            Assert.All(generated, plan => { Assert.True(plan.PlanDate > today); Assert.NotEqual(DayOfWeek.Sunday, plan.PlanDate.DayOfWeek); });
            foreach (var plan in generated.Where(plan => plan.StepNo == 2)) {
                var upstream = plans.Where(item => item.StepNo == 1 && item.PlanDate < plan.PlanDate).Sum(item => item.GoodQty ?? item.PlannedQty);
                var downstream = plans.Where(item => item.StepNo == 2 && item.PlanDate <= plan.PlanDate).Sum(item => item.GoodQty ?? item.PlannedQty);
                Assert.True(downstream <= upstream);
            }
        });
        await AssertActuals();
    }

    [Fact]
    public async Task BackgroundReflow_DoesNotModifyAnotherFactory()
    {
        await factory.WithDbAsync(async db => {
            var order = new Order { FactoryId = "HUADENG", ExternalOrderNo = "HU-MAT", PartQtys = new() { new() { PartName = "H", Qty = 10 } } };
            db.Orders.Add(order); await db.SaveChangesAsync();
            db.OrderMaterials.Add(new() { FactoryId = "HUADENG", OrderId = order.Id, PartName = "H", ExpectedDate = today.AddDays(-1), Version = 1 });
            db.ProductionPlans.Add(new() { FactoryId = "HUADENG", OrderId = order.Id, LineId = lineId, PartName = "H", PlannedQty = 10, PlanDate = today }); await db.SaveChangesAsync();
        });
        (await Save(orderA, 20)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            await MaterialReflowWorker.ReflowDue(db, "XINGXIN");
            Assert.Equal(1, (await db.OrderMaterials.SingleAsync(material => material.FactoryId == "HUADENG")).Version);
            Assert.Null((await db.ProductionPlans.SingleAsync(plan => plan.FactoryId == "HUADENG")).DeletedAt);
        });
    }

    [Fact]
    public async Task ManualUnschedule_PausesAutomaticReflowUntilMaterialIsExplicitlySavedAgain()
    {
        (await Save(orderB, 80, actual: Ymd(today))).EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/schedule/orders/{orderB}/unschedule", null)).EnsureSuccessStatusCode();
        Assert.Equal("自动重排已暂停", (await Row(orderB)).GetProperty("status").GetString());
        await factory.WithDbAsync(async db => {
            var record = await db.OrderMaterials.SingleAsync(material => material.OrderId == orderB);
            record.ExpectedDate = today.AddDays(-1); record.LastReflowDate = today.AddDays(-1); await db.SaveChangesAsync();
            Assert.Null(await MaterialReflowWorker.ReflowDue(db, "XINGXIN"));
            Assert.False(await db.ProductionPlans.AnyAsync(plan => plan.OrderId == orderB && plan.DeletedAt == null));
        });
        (await Save(orderB, 80, actual: Ymd(today))).EnsureSuccessStatusCode();
        Assert.Equal("齐料", (await Row(orderB)).GetProperty("status").GetString());
        await factory.WithDbAsync(async db => Assert.True(await db.ProductionPlans.AnyAsync(plan => plan.OrderId == orderB && plan.DeletedAt == null)));
    }

    [Fact]
    public async Task RepeatedIdenticalSave_DoesNotDuplicatePlansOrHistory()
    {
        (await Save(orderA, 100, actual: Ymd(today))).EnsureSuccessStatusCode(); var before = await Snapshot();
        (await Save(orderA, 100, actual: Ymd(today))).EnsureSuccessStatusCode(); Assert.Equal(before, await Snapshot());
        await factory.WithDbAsync(async db => {
            var record = await db.OrderMaterials.SingleAsync(material => material.OrderId == orderA);
            record.ExpectedDate = today.AddDays(-1); record.LastReflowDate = today.AddDays(-1); await db.SaveChangesAsync();
            // 已到齐的材料不应因旧预计日过期而每天重复重排。
            Assert.Null(await MaterialReflowWorker.ReflowDue(db, "XINGXIN"));
        });
    }

    [Fact]
    public async Task QuantityAutoAdjustment_RespectsRegisteredMaterialLimit()
    {
        (await Save(orderA, 50, actual: Ymd(today))).EnsureSuccessStatusCode();
        var partId = 0; await factory.WithDbAsync(async db => partId = await db.OrderPartQtys.Where(part => part.OrderId == orderA).Select(part => part.Id).SingleAsync());
        (await client.PatchAsJsonAsync($"/api/orders/{orderA}", new { partQtys = new[] { new { id = partId, qty = 150 } }, autoAdjustSchedule = true })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => Assert.Equal(30, await db.ProductionPlans.Where(plan => plan.OrderId == orderA && plan.DeletedAt == null && plan.GoodQty == null).SumAsync(plan => plan.PlannedQty)));
        Assert.Equal(100, (await Row(orderA)).GetProperty("waitingQty").GetInt32()); await AssertActuals();
    }

    [Fact]
    public async Task InvalidResource_RollsBackMaterialAndPlanChangesTogether()
    {
        await factory.WithDbAsync(async db => { (await db.ProductionLines.SingleAsync(line => line.Id == lineId)).IsActive = false; await db.SaveChangesAsync(); });
        var before = await Snapshot(); Assert.Equal(HttpStatusCode.BadRequest, (await Save(orderA, 100)).StatusCode); Assert.Equal(before, await Snapshot());
    }

    [Theory]
    [InlineData(-1, null, null)]
    [InlineData(19, null, null)]
    [InlineData(100, "bad-date", null)]
    [InlineData(100, null, "2099-01-01")]
    public async Task InvalidInput_DoesNotSave(int qty, string? expected, string? actual)
    {
        var before = await Snapshot(); Assert.Equal(HttpStatusCode.BadRequest, (await Save(orderA, qty, expected, actual)).StatusCode); Assert.Equal(before, await Snapshot());
    }

    [Fact]
    public async Task StaleVersion_IsRejected_AndViewerCannotWrite()
    {
        (await Save(orderA, 50)).EnsureSuccessStatusCode(); var before = await Snapshot();
        var response = await client.PutAsJsonAsync("/api/materials", new { orderId = orderA, partName = "A", arrivedQty = 100, version = 0 });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode); Assert.Equal(before, await Snapshot());
        await Login("viewer", "viewer123"); Assert.Equal(HttpStatusCode.Forbidden, (await Save(orderA, 100)).StatusCode);
    }

    private async Task<HttpResponseMessage> CreateFirstMaterialSchedule(string route)
    {
        var partId = 0;
        await factory.WithDbAsync(async db => partId = await db.ProductParts.Where(part => part.PartName == "B").Select(part => part.Id).SingleAsync());
        var date = Ymd(Work(today));
        if (route == "monthly")
            return await client.PostAsJsonAsync("/api/schedule/auto/commit", new { month = date[..7], mode = "incremental", draft = new[] { new {
                orderId = orderB, externalOrderNo = "MATERIAL-B", productNo = "MATERIAL", sourcePartId = partId,
                itemName = "", partName = "B", planDate = date, plannedQty = 80, lineId, lineName = "Fixture", stepNo = 1, craft = "移印",
            } } });
        if (route == "urgent")
            return await client.PostAsJsonAsync("/api/schedule/urgent/commit", new { urgentOrderId = orderB, pausedOrderIds = Array.Empty<int>(), rows = new[] { new {
                planDate = date, lineId, partName = "B", sourcePartId = partId, plannedQty = 80, workerCount = 1, machineNos = "[]",
            } } });
        return await client.PostAsJsonAsync("/api/plans", new { plans = new[] { new {
            planDate = date, lineId, orderId = orderB, partName = "B", plannedQty = 80,
        } } });
    }

    [Theory]
    [InlineData("manual", 0)]
    [InlineData("monthly", 0)]
    [InlineData("urgent", 0)]
    [InlineData("manual", 30)]
    [InlineData("monthly", 30)]
    [InlineData("urgent", 30)]
    public async Task FirstScheduleAfterMaterialRegistration_StillHonorsMissingMaterial(string route, int arrived)
    {
        await factory.WithDbAsync(async db => {
            db.ProductionPlans.RemoveRange(await db.ProductionPlans.Where(plan => plan.OrderId == orderB).ToListAsync());
            await db.SaveChangesAsync();
        });
        (await Save(orderB, arrived)).EnsureSuccessStatusCode();
        (await CreateFirstMaterialSchedule(route)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.Equal(arrived, await db.ProductionPlans.Where(plan => plan.OrderId == orderB && plan.DeletedAt == null).SumAsync(plan => plan.PlannedQty));
            var record = await db.OrderMaterials.SingleAsync(material => material.OrderId == orderB);
            Assert.NotEqual("[]", record.Configuration);
        });
        Assert.Equal(80 - arrived, (await Row(orderB)).GetProperty("waitingQty").GetInt32());
        await AssertActuals();
    }

    [Theory]
    [InlineData("manual")]
    [InlineData("monthly")]
    [InlineData("urgent")]
    public async Task FirstScheduleMaterialFailure_RollsBackWholeCreation(string route)
    {
        await factory.WithDbAsync(async db => {
            db.ProductionPlans.RemoveRange(await db.ProductionPlans.Where(plan => plan.OrderId == orderB).ToListAsync());
            await db.SaveChangesAsync();
        });
        (await Save(orderB, 30)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            (await db.ProductionLines.SingleAsync(line => line.Id == lineId)).IsActive = false;
            await db.SaveChangesAsync();
        });
        var before = await Snapshot();
        Assert.Equal(HttpStatusCode.BadRequest, (await CreateFirstMaterialSchedule(route)).StatusCode);
        Assert.Equal(before, await Snapshot());
    }

    [Fact]
    public async Task OtherFactoryOrder_IsNotVisibleOrEditable()
    {
        await factory.WithDbAsync(async db => { (await db.Orders.SingleAsync(order => order.Id == orderA)).FactoryId = "HUADENG"; await db.SaveChangesAsync(); });
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>($"/api/materials?orderId={orderA}")).EnumerateArray());
        var response = await client.PutAsJsonAsync("/api/materials", new { orderId = orderA, partName = "A", arrivedQty = 100, version = 0 });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
