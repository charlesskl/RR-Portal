using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Plans;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

public class PlanWorkbenchTests : IAsyncLifetime
{
    readonly ApiFactory factory = new();
    HttpClient client = null!;
    static readonly DateTime Day = DateUtil.ParseUtc("2030-01-07"); // 周一
    record Data(List<WorkbenchRow> Rows);
    public async Task InitializeAsync()
    {
        client = factory.CreateClient(); await factory.SeedAsync();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "TABLE-P" };
            var order = new Order { ExternalOrderNo = "TABLE-O", Product = product, Status = "in_production", DeliveryDate = Day.AddDays(2),
                PartQtys = [new() { PartName = "头", Qty = 500 }, new() { PartName = "脚", Qty = 500 }] };
            db.ProductionPlans.AddRange(
                new() { LineId = 1, Order = order, PartName = "头", Craft = "移印", PlanDate = Day, PlannedQty = 100, WorkerCount = 2, MachineNos = "[\"5#\"]" },
                new() { LineId = 1, Order = order, PartName = "脚", Craft = "移印", PlanDate = Day, PlannedQty = 100 },
                new() { LineId = 1, Order = order, PartName = "头", Craft = "移印", PlanDate = Day.AddDays(-1), PlannedQty = 20, GoodQty = 18,
                    InboundQty = 15, ReportedQty = 20, Status = "recorded", ProductionValue = 50, ModificationHistory = "[]" });
            await db.SaveChangesAsync();
            db.InventoryMoves.Add(new InventoryMove { ProductId = product.Id, PartName = "头", Delta = 3, Reason = "basket_overflow" });
            await db.SaveChangesAsync();
        });
    }
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    async Task<List<WorkbenchRow>> Rows() => (await client.GetFromJsonAsync<Data>("/api/plans/workbench?from=2030-01-06&to=2030-02-07"))!.Rows;
    static WorkbenchChange Change(WorkbenchRow row, Func<WorkbenchValues, WorkbenchValues> edit) => new(row.Id, row.Token, edit(row.Values));
    Task<HttpResponseMessage> Save(IEnumerable<WorkbenchChange> changes, bool preview = false)
        => client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest(changes.ToList(), preview, "来料变化"));
    async Task<string> ProtectedSnapshot()
    {
        string result = "";
        await factory.WithDbAsync(async db => { result = JsonSerializer.Serialize(new {
            actuals = await db.ProductionPlans.AsNoTracking().Where(p => p.Status == "recorded").ToListAsync(),
            inventory = await db.InventoryMoves.AsNoTracking().ToListAsync(), inbound = await db.InboundApplications.AsNoTracking().ToListAsync(),
            demand = await db.OrderPartQtys.AsNoTracking().ToListAsync() }); });
        return result;
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExcessDetailsIncludeAllDatesAdjustedDraftsAndActuals_WithoutSaving(bool preview)
    {
        await factory.WithDbAsync(async db => {
            db.ProductionPlans.Add(new() { LineId = 1, OrderId = (await db.Orders.SingleAsync()).Id,
                PartName = "头", Craft = "移印", PlanDate = Day.AddMonths(2), PlannedQty = 200 });
            await db.SaveChangesAsync();
        });
        var snapshot = await ProtectedSnapshot();
        var rows = (await Rows()).Where(r => r.LockedReason == null).ToList();
        var response = await Save(rows.Select(r => Change(r, v => v with { PlannedQty = 600, PlanDate = "2030-01-08" })), preview);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var details = body.GetProperty("excessDetails").EnumerateArray().ToList();
        Assert.Equal(2, details.Count);
        var head = details.Single(d => d.GetProperty("partName").GetString() == "头");
        Assert.Equal(500, head.GetProperty("demand").GetInt64());
        Assert.Equal(18, head.GetProperty("produced").GetInt64());
        Assert.Equal(800, head.GetProperty("unreportedPlanned").GetInt64());
        Assert.Equal(318, head.GetProperty("excess").GetInt64());
        var plans = head.GetProperty("plans").EnumerateArray().ToList();
        Assert.Equal(818, plans.Sum(p => p.GetProperty("countedQty").GetInt64()));
        Assert.Contains(plans, p => p.GetProperty("date").GetString() == "2030-03-07" && p.GetProperty("plannedQty").GetInt32() == 200);
        Assert.Contains(plans, p => p.GetProperty("date").GetString() == "2030-01-08" && p.GetProperty("originalDate").GetString() == "2030-01-07" && p.GetProperty("adjusted").GetBoolean());
        Assert.Equal(snapshot, await ProtectedSnapshot());
        Assert.All((await Rows()).Where(r => r.LockedReason == null), r => Assert.Equal(100, r.Values.PlannedQty));
    }

    [Fact]
    public async Task BalancesIncludeAllDatesAndLines_SeparateStepsPartsOrdersAndFactories_IgnoreDeleted()
    {
        await AddFuture(80, 120, part: "头");
        await AddFuture(500, 120, step: 2, part: "头");
        await factory.WithDbAsync(async db => {
            var line = new ProductionLine { Name = "另一条移印拉", CraftType = "移印" };
            db.ProductionLines.Add(line); await db.SaveChangesAsync();
            db.ProductionPlans.AddRange(
                new() { OrderId = 1, LineId = line.Id, PartName = "头", PlanDate = Day.AddDays(120), PlannedQty = 120 },
                new() { OrderId = 1, LineId = 1, PartName = "头", PlanDate = Day, PlannedQty = 900, DeletedAt = DateTime.UtcNow },
                new() { OrderId = 1, LineId = 1, FactoryId = "HUADENG", PartName = "头", PlanDate = Day, PlannedQty = 900 });
            var other = new Order { ExternalOrderNo = "OTHER", PartQtys = [new() { PartName = "头", Qty = 900 }] };
            db.ProductionPlans.Add(new() { Order = other, LineId = 1, PartName = "头", PlanDate = Day, PlannedQty = 900 });
            await db.SaveChangesAsync();
        });
        var snapshot = await ProtectedSnapshot();
        var rows = (await client.GetFromJsonAsync<Data>("/api/plans/workbench?from=2030-01-07&to=2030-01-07&orderId=1"))!.Rows;
        Assert.Equal(2, rows.Count);
        var row = rows.Single(r => r.PartName == "头"); var balance = row.Balance!;
        Assert.Equal(1, row.OrderId); Assert.Null(row.GoodQty);
        Assert.Equal(500, balance.Demand); Assert.Equal(18, balance.Produced);
        Assert.Equal(300, balance.UnreportedPlanned); Assert.Equal(182, balance.RemainingToSchedule);
        Assert.Equal(100, rows.Single(r => r.PartName == "脚").Balance!.UnreportedPlanned);
        Assert.Equal(snapshot, await ProtectedSnapshot());
    }

    [Theory]
    [InlineData(0, 20, 0, 0)]
    [InlineData(null, 17, 17, 1)]
    [InlineData(null, null, 20, 1)]
    public async Task BalanceActualsUseValidationQuantityBasis_AndMarkLegacyFallback(int? good, int? reported, int expected, int fallback)
    {
        await factory.WithDbAsync(async db => { var actual = await db.ProductionPlans.FindAsync(3); actual!.GoodQty = good; actual.ReportedQty = reported; await db.SaveChangesAsync(); });
        var balance = (await Rows()).Single(r => r.Id == 1).Balance!;
        Assert.Equal(expected, balance.Produced); Assert.Equal(fallback, balance.ActualFallbackCount);
        Assert.Equal(400 - expected, balance.RemainingToSchedule);
    }

    [Theory]
    [InlineData(false, 450, 32)]
    [InlineData(true, 400, 82)]
    public async Task PreviewAndSaveBalancesIncludeDraftAndAutomaticDeductionsOutsideLoadedRange(bool auto, long planned, long remaining)
    {
        await AddFuture(300, 120, part: "头");
        var row = (await Rows()).Single(r => r.Id == 1); var snapshot = await ProtectedSnapshot();
        var request = new WorkbenchRequest([Change(row, v => v with { PlannedQty = 150 })], AutoDeduct: auto);
        var response = await client.PostAsJsonAsync("/api/plans/workbench", request); response.EnsureSuccessStatusCode();
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        var balance = Assert.Single(preview.GetProperty("balances").EnumerateArray());
        Assert.Equal(18, balance.GetProperty("produced").GetInt64());
        Assert.Equal(planned, balance.GetProperty("unreportedPlanned").GetInt64());
        Assert.Equal(remaining, balance.GetProperty("remainingToSchedule").GetInt64());
        Assert.Equal(100, (await Rows()).Single(r => r.Id == 1).Values.PlannedQty);
        (await client.PostAsJsonAsync("/api/plans/workbench", request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() })).EnsureSuccessStatusCode();
        Assert.Equal(planned, (await Rows()).Single(r => r.Id == 1).Balance!.UnreportedPlanned);
        Assert.Equal(snapshot, await ProtectedSnapshot());
    }

    [Fact]
    public async Task RemainingNeverGoesNegative_AndLargePlanTotalsUseLong()
    {
        await AddFuture(2_000_000_000, 120, part: "头");
        await AddFuture(2_000_000_000, 121, part: "头");
        var balance = (await Rows()).Single(r => r.Id == 1).Balance!;
        Assert.Equal(4_000_000_100L, balance.UnreportedPlanned); Assert.Equal(0, balance.RemainingToSchedule);
    }

    [Theory]
    [InlineData(0, 20, 0, false)]
    [InlineData(null, 17, 17, true)]
    [InlineData(null, null, 20, true)]
    public async Task ExcessDetailsUseTheSameActualQuantityBasisAsValidation(int? good, int? reported, int expected, bool fallback)
    {
        await factory.WithDbAsync(async db => {
            var actual = await db.ProductionPlans.SingleAsync(p => p.Id == 3);
            actual.GoodQty = good; actual.ReportedQty = reported; await db.SaveChangesAsync();
        });
        var row = (await Rows()).Single(r => r.Id == 1);
        var response = await Save([Change(row, v => v with { PlannedQty = 600 })]);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("excessDetails")[0];
        Assert.Equal(expected, detail.GetProperty("produced").GetInt64());
        Assert.Equal(100 + expected, detail.GetProperty("excess").GetInt64());
        var actualRow = detail.GetProperty("plans").EnumerateArray().Single(p => p.GetProperty("recorded").GetBoolean());
        Assert.Equal(fallback, actualRow.GetProperty("actualFallback").GetBoolean());
    }

    [Fact]
    public async Task ReducingExistingExcessRemainsAllowed()
    {
        await factory.WithDbAsync(async db => {
            (await db.ProductionPlans.SingleAsync(p => p.Id == 1)).PlannedQty = 600;
            await db.SaveChangesAsync();
        });
        var row = (await Rows()).Single(r => r.Id == 1);
        (await Save([Change(row, v => v with { PlannedQty = 550 })])).EnsureSuccessStatusCode();
        Assert.Equal(550, (await Rows()).Single(r => r.Id == 1).Values.PlannedQty);
    }

    [Fact]
    public async Task PreviewIsReadOnly_SaveIsAtomicAndAudited_ActualsInventoryAndDemandStayUnchanged()
    {
        var rows = (await Rows()).Where(r => r.LockedReason == null).ToList();
        var changes = rows.Select(r => Change(r, v => v with { PlannedQty = 120, PlanDate = "2030-01-08", WorkerCount = 3, WorkHours = 8.5, Remark = "调整" })).ToList();
        var snapshot = await ProtectedSnapshot();
        var response = await Save(changes, true); response.EnsureSuccessStatusCode();
        Assert.All((await Rows()).Where(r => r.LockedReason == null), r => Assert.Equal(100, r.Values.PlannedQty));
        (await Save(changes)).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await ProtectedSnapshot());
        var after = (await Rows()).Where(r => r.LockedReason == null).ToList();
        Assert.All(after, r => { Assert.Equal(120, r.Values.PlannedQty); Assert.Equal("2030-01-08", r.Values.PlanDate); Assert.Equal(8.5, r.Values.WorkHours); Assert.Equal("调整", r.Values.Remark); });
        await factory.WithDbAsync(async db => {
            Assert.All(await db.ProductionPlans.Where(p => p.Status != "recorded").ToListAsync(), p => {
                Assert.Equal("clerk", p.LastModifiedBy); Assert.Contains("table_plan_edit", p.ModificationHistory); Assert.Equal("来料变化", JsonSerializer.Deserialize<JsonElement>(p.ModificationHistory)[0].GetProperty("reason").GetString()); });
            Assert.Equal("in_production", (await db.Orders.SingleAsync()).Status);
        });
    }

    [Theory]
    [InlineData("recorded")]
    [InlineData("stale")]
    [InlineData("deleted")]
    [InlineData("closed")]
    [InlineData("inbound")]
    public async Task OneProtectedOrStaleRowRejectsEntireBatch(string kind)
    {
        var rows = (await Rows()).Where(r => r.LockedReason == null).ToList(); var second = rows[1].Id;
        await factory.WithDbAsync(async db => {
            var p = await db.ProductionPlans.Include(p => p.Order).SingleAsync(p => p.Id == second);
            if (kind == "recorded") p.GoodQty = 0;
            if (kind == "stale") p.WorkerCount = 9;
            if (kind == "deleted") p.DeletedAt = DateTime.UtcNow;
            if (kind == "closed") p.Order!.Status = "completed";
            if (kind == "inbound") db.InboundApplications.Add(new InboundApplication { ApplicationNo = "TABLE-IN", SourcePlanId = p.Id, Quantity = 1 });
            await db.SaveChangesAsync();
        });
        var response = await Save(rows.Select(r => Change(r, v => v with { PlannedQty = 90 })));
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Conflict, HttpStatusCode.BadRequest });
        await factory.WithDbAsync(async db => Assert.All(await db.ProductionPlans.Where(p => p.Id != 3).ToListAsync(), p => Assert.Equal(100, p.PlannedQty)));
    }

    [Theory]
    [InlineData(1.5, "2030-01-08", 8, 1)]
    [InlineData(0, "2030-01-08", 8, 1)]
    [InlineData(100, "2030-02-30", 8, 1)]
    [InlineData(100, "2030-01-13", 8, 1)]
    [InlineData(100, "2030-01-08", 25, 1)]
    [InlineData(100, "2030-01-08", 8, 999)]
    [InlineData(600, "2030-01-08", 8, 1)]
    public async Task InvalidNumbersDatesLinesOrOverDemandAreRejected(double qty, string date, double hours, int line)
    {
        var row = (await Rows()).First(r => r.LockedReason == null);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save([Change(row, v => v with { PlannedQty = qty, PlanDate = date, WorkHours = hours, LineId = line })])).StatusCode);
        Assert.Equal(100, (await Rows()).Single(r => r.Id == row.Id).Values.PlannedQty);
    }

    [Fact]
    public async Task RegisteredMaterialLimitsAreEnforced_ManualProductionEditsPauseReflow_ButNotesDoNot()
    {
        var row = (await Rows()).First(r => r.PartName == "脚");
        await factory.WithDbAsync(async db => {
            db.OrderMaterials.Add(new OrderMaterial { OrderId = 1, PartName = "脚", ArrivedQty = 110, UpdatedAt = DateTime.UtcNow, AutoScheduleEnabled = true });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.BadRequest, (await Save([Change(row, v => v with { PlannedQty = 120 })])).StatusCode);
        (await Save([Change(row, v => v with { Remark = "仅备注" })])).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => Assert.True((await db.OrderMaterials.SingleAsync()).AutoScheduleEnabled));
        row = (await Rows()).Single(r => r.Id == row.Id);
        var change = Change(row, v => v with { PlannedQty = 90 });
        (await Save([change], true)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => Assert.True((await db.OrderMaterials.SingleAsync()).AutoScheduleEnabled));
        (await Save([change])).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var material = await db.OrderMaterials.SingleAsync(); Assert.False(material.AutoScheduleEnabled);
            Assert.Equal(110, material.ArrivedQty); Assert.Contains("manual_table_edit_pause", material.History);
        });
    }

    [Fact]
    public async Task MachineAndCraftMustMatchTargetLine_ValidSwapCanBeSaved()
    {
        await factory.WithDbAsync(async db => {
            db.ProductionLines.AddRange(new ProductionLine { Name = "另一移印拉", CraftType = "移印" }, new ProductionLine { Name = "手喷拉", CraftType = "手喷" });
            await db.SaveChangesAsync(); db.Machines.Add(new Machine { LineId = 2, MachineNo = "9#", MachineType = "移印" }); await db.SaveChangesAsync();
        });
        var row = (await Rows()).First(r => r.LockedReason == null);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save([Change(row, v => v with { LineId = 3, MachineNos = [] })])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save([Change(row, v => v with { LineId = 2, MachineNos = ["5#"] })])).StatusCode);
        (await Save([Change(row, v => v with { LineId = 2, MachineNos = ["9#"] })])).EnsureSuccessStatusCode();
        Assert.Equal(2, (await Rows()).Single(r => r.Id == row.Id).Values.LineId);
    }

    [Fact]
    public async Task LaterStepCannotBeMovedBeforeUpstream_WholeChainCanMoveTogether()
    {
        var row = (await Rows()).First(r => r.PartName == "脚");
        await factory.WithDbAsync(async db => {
            db.ProductionPlans.Add(new ProductionPlan { LineId = 1, OrderId = 1, PartName = "脚", StepNo = 2, Craft = "移印", PlanDate = Day.AddDays(1), PlannedQty = 100 });
            await db.SaveChangesAsync();
        });
        var downstream = (await Rows()).Single(r => r.StepNo == 2);
        Assert.Equal(HttpStatusCode.BadRequest, (await Save([Change(downstream, v => v with { PlanDate = "2030-01-05" })])).StatusCode);
        (await Save(new[] { row, downstream }.Select(r => Change(r, v => v with { PlanDate = "2030-01-09" })))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task PreviewReportsCapacityDeliveryAndRemainingWithoutCommitting()
    {
        await factory.WithDbAsync(async db => { (await db.ProductionLines.SingleAsync()).DailyCapacityLimit = 100; await db.SaveChangesAsync(); });
        var row = (await Rows()).First(r => r.LockedReason == null);
        var response = await Save([Change(row, v => v with { PlanDate = "2030-01-12", PlannedQty = 150 })], true);
        response.EnsureSuccessStatusCode(); var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("超过日产能", text); Assert.Contains("晚于交货日", text); Assert.Contains("未排", text);
        Assert.Equal(row.Token, (await Rows()).Single(r => r.Id == row.Id).Token);
    }

    [Fact]
    public async Task ConcurrentSavesCannotOverwriteEachOther()
    {
        var row = (await Rows()).First(r => r.LockedReason == null);
        var responses = await Task.WhenAll(Save([Change(row, v => v with { PlannedQty = 90 })]), Save([Change(row, v => v with { PlannedQty = 80 })]));
        Assert.Single(responses.Where(r => r.IsSuccessStatusCode));
        Assert.Single(responses.Where(r => r.StatusCode == HttpStatusCode.Conflict));
        var saved = (await Rows()).Single(r => r.Id == row.Id);
        Assert.Contains(saved.Values.PlannedQty, new double[] { 80, 90 });
    }

    [Fact]
    public async Task NoOpDoesNotNormalizeOtherRows_AndSharedPeopleGroupsAreExplicitlyDetached()
    {
        await factory.WithDbAsync(async db => {
            var rows = await db.ProductionPlans.Where(p => p.Status != "recorded").OrderBy(p => p.Id).ToListAsync();
            rows[0].GroupNo = 7; rows[1].GroupNo = 7; rows[1].MachineNos = "[ ]"; rows[1].Remark = null;
            await db.SaveChangesAsync();
        });
        var rows = (await Rows()).Where(r => r.LockedReason == null).OrderBy(r => r.Id).ToList();
        var changes = new[] { Change(rows[0], v => v with { WorkerCount = 4 }), Change(rows[1], v => v) };
        var preview = await Save(changes, true); preview.EnsureSuccessStatusCode();
        Assert.Contains("共享人数分组", await preview.Content.ReadAsStringAsync());
        (await Save(changes)).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => p.Status != "recorded").OrderBy(p => p.Id).ToListAsync();
            Assert.Null(plans[0].GroupNo); Assert.Equal(7, plans[1].GroupNo);
            Assert.Equal("[ ]", plans[1].MachineNos); Assert.Null(plans[1].Remark); Assert.Equal("[]", plans[1].ModificationHistory);
        });
    }

    [Fact]
    public async Task AutoDeductPreviewsAcrossDates_PartialAndFullDonors_SaveConservesTotalAndHistory()
    {
        var near = await AddFuture(80, 1); var far = await AddFuture(90, 2);
        await factory.WithDbAsync(async db => { (await db.OrderPartQtys.SingleAsync(q => q.PartName == "脚")).Qty = 270; await db.SaveChangesAsync(); });
        var row = (await Rows()).Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var snapshot = await ProtectedSnapshot();
        var (preview, commit) = await AutoPreview([Change(row, v => v with { PlannedQty = 220 })]);
        Assert.Equal(3, preview.GetProperty("adjustedPlans").GetInt32());
        Assert.Equal(2, preview.GetProperty("transfers").GetArrayLength());
        Assert.Equal(near, preview.GetProperty("transfers")[0].GetProperty("sourcePlanId").GetInt32());
        Assert.Equal(80, preview.GetProperty("transfers")[0].GetProperty("quantity").GetInt32());
        Assert.True(preview.GetProperty("changes").EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == near).GetProperty("removed").GetBoolean());
        Assert.Equal(snapshot, await ProtectedSnapshot());
        Assert.Equal(80, (await Rows()).Single(r => r.Id == near).Values.PlannedQty);
        (await client.PostAsJsonAsync("/api/plans/workbench", commit)).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await ProtectedSnapshot());
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => p.PartName == "脚").ToListAsync();
            Assert.Equal(270, plans.Where(p => p.DeletedAt == null).Sum(p => p.PlannedQty));
            Assert.NotNull(plans.Single(p => p.Id == near).DeletedAt);
            Assert.Equal(80, plans.Single(p => p.Id == near).PlannedQty); // 撤销保留原始计划数
            Assert.Equal(50, plans.Single(p => p.Id == far).PlannedQty);
            Assert.Contains("table_auto_deduct", plans.Single(p => p.Id == near).ModificationHistory);
            var trace = JsonSerializer.Deserialize<JsonElement>(plans.Single(p => p.Id == near).ModificationHistory)[0].GetProperty("quantityTransfers")[0];
            Assert.Equal(row.Id, trace.GetProperty("TargetPlanId").GetInt32());
            Assert.Equal(near, trace.GetProperty("SourcePlanId").GetInt32());
        });
    }

    [Fact]
    public async Task AutoDeductExcludesActualsInboundOtherPartsAndOtherSteps_InsufficientIsAtomic()
    {
        await AddFuture(100, 1, recorded: true);
        var inbound = await AddFuture(100, 2);
        await AddFuture(100, 3, step: 2);
        await AddFuture(100, 4, part: "头");
        await factory.WithDbAsync(async db => { db.InboundApplications.Add(new InboundApplication { ApplicationNo = "FUTURE-IN", SourcePlanId = inbound, Quantity = 1 }); await db.SaveChangesAsync(); });
        var row = (await Rows()).Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var snapshot = await ProtectedSnapshot();
        var response = await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([Change(row, v => v with { PlannedQty = 150 })], AutoDeduct: true));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("仅 0 件", await response.Content.ReadAsStringAsync());
        Assert.Equal(snapshot, await ProtectedSnapshot());
        Assert.Equal(100, (await Rows()).Single(r => r.Id == row.Id).Values.PlannedQty);
    }

    [Theory]
    [InlineData("record")]
    [InlineData("inbound")]
    [InlineData("quantity")]
    [InlineData("new-plan")]
    [InlineData("cancel")]
    public async Task AutoDeductMustRepreviewWhenDonorPoolChanges(string kind)
    {
        var donor = await AddFuture(100, 1);
        var row = (await Rows()).Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var (_, commit) = await AutoPreview([Change(row, v => v with { PlannedQty = 150 })]);
        await factory.WithDbAsync(async db => {
            var plan = await db.ProductionPlans.FindAsync(donor);
            if (kind == "record") plan!.GoodQty = 0;
            if (kind == "inbound") db.InboundApplications.Add(new InboundApplication { ApplicationNo = "LATE-IN", SourcePlanId = donor, Quantity = 1 });
            if (kind == "quantity") plan!.PlannedQty = 90;
            if (kind == "cancel") plan!.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        if (kind == "new-plan") await AddFuture(100, 2);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/plans/workbench", commit)).StatusCode);
        Assert.Equal(100, (await Rows()).Single(r => r.Id == row.Id).Values.PlannedQty);
    }

    [Fact]
    public async Task ManualReductionsOffsetIncreases_AndEditedRowsAreNeverAutomaticDonors()
    {
        var edited = await AddFuture(100, 1); var donor = await AddFuture(100, 2);
        var rows = await Rows(); var target = rows.Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var changes = new[] { Change(target, v => v with { PlannedQty = 160 }), Change(rows.Single(r => r.Id == edited), v => v with { PlannedQty = 60 }) };
        var (preview, commit) = await AutoPreview(changes.ToList());
        var transfer = Assert.Single(preview.GetProperty("transfers").EnumerateArray());
        Assert.Equal(donor, transfer.GetProperty("sourcePlanId").GetInt32()); Assert.Equal(20, transfer.GetProperty("quantity").GetInt32());
        (await client.PostAsJsonAsync("/api/plans/workbench", commit)).EnsureSuccessStatusCode();
        Assert.Equal(60, (await Rows()).Single(r => r.Id == edited).Values.PlannedQty);
    }

    [Fact]
    public async Task PreviewTokenIsRequired_AndCannotBeReusedForDifferentQuantities()
    {
        await AddFuture(100, 1);
        var row = (await Rows()).Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var (_, commit) = await AutoPreview([Change(row, v => v with { PlannedQty = 150 })]);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/plans/workbench", commit with { AllocationToken = null })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/plans/workbench", commit with { Changes = [Change(row, v => v with { PlannedQty = 160 })] })).StatusCode);
    }

    [Fact]
    public async Task AutoDeductStillEnforcesMaterialAvailability()
    {
        await AddFuture(100, 1);
        await factory.WithDbAsync(async db => { db.OrderMaterials.Add(new OrderMaterial { OrderId = 1, PartName = "脚", ArrivedQty = 100, ExpectedDate = Day.AddDays(1) }); await db.SaveChangesAsync(); });
        var row = (await Rows()).Single(r => r.PartName == "脚" && r.Values.PlanDate == "2030-01-07");
        var response = await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([Change(row, v => v with { PlannedQty = 150 })], AutoDeduct: true));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("来料", await response.Content.ReadAsStringAsync());
    }

    async Task<int> AddFuture(int qty, int days, bool recorded = false, int step = 1, string part = "脚")
    {
        int id = 0;
        await factory.WithDbAsync(async db => {
            var p = new ProductionPlan { OrderId = 1, LineId = 1, PartName = part, StepNo = step, Craft = "移印", PlanDate = Day.AddDays(days), PlannedQty = qty, GoodQty = recorded ? 0 : null };
            db.ProductionPlans.Add(p); await db.SaveChangesAsync(); id = p.Id;
        });
        return id;
    }
    async Task<(JsonElement Preview, WorkbenchRequest Commit)> AutoPreview(List<WorkbenchChange> changes)
    {
        var request = new WorkbenchRequest(changes, AutoDeduct: true);
        var response = await client.PostAsJsonAsync("/api/plans/workbench", request); response.EnsureSuccessStatusCode();
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (preview, request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() });
    }

    [Fact]
    public async Task NewProductAndExistingEditsPreviewAndSaveTogether_ProtectHistoryAndScheduleOrder()
    {
        var option = await NewProductOption();
        var existing = (await Rows()).First(r => r.LockedReason == null);
        var snapshot = await ProtectedSnapshot();
        var addition = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, option.Token, existing.Values with { PlannedQty = 80, Remark = "临时加单" });
        var request = new WorkbenchRequest([Change(existing, v => v with { PlannedQty = 90 })], AutoDeduct: true, Additions: [addition]);
        var response = await client.PostAsJsonAsync("/api/plans/workbench/batch", request); response.EnsureSuccessStatusCode();
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, preview.GetProperty("adjustedPlans").GetInt32()); Assert.Equal(1, preview.GetProperty("createdPlans").GetInt32());
        var newBalance = preview.GetProperty("balances").EnumerateArray().Single(b => b.GetProperty("orderId").GetInt32() == option.OrderId);
        Assert.Equal(0, newBalance.GetProperty("produced").GetInt64()); Assert.Equal(80, newBalance.GetProperty("unreportedPlanned").GetInt64());
        Assert.Equal(920, newBalance.GetProperty("remainingToSchedule").GetInt64());
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(p => p.OrderId == option.OrderId)));
        var save = await client.PostAsJsonAsync("/api/plans/workbench/batch", request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() });
        save.EnsureSuccessStatusCode(); Assert.Equal(snapshot, await ProtectedSnapshot());
        await factory.WithDbAsync(async db => {
            var plan = await db.ProductionPlans.SingleAsync(p => p.OrderId == option.OrderId);
            Assert.True(plan.Id > 0); Assert.Equal(80, plan.PlannedQty); Assert.Equal(option.SourcePartId, plan.SourcePartId);
            Assert.Equal("临时加单", plan.Remark); Assert.Contains("table_plan_create", plan.ModificationHistory);
            Assert.Equal("scheduled", (await db.Orders.FindAsync(option.OrderId))!.Status);
        });
    }

    [Theory]
    [InlineData("quantity")]
    [InlineData("line")]
    [InlineData("holiday")]
    [InlineData("stale")]
    [InlineData("closed")]
    public async Task InvalidAdditionRollsBackEntireBatch(string kind)
    {
        var option = await NewProductOption(); var existing = (await Rows()).First(r => r.LockedReason == null);
        var value = existing.Values with { PlannedQty = kind == "quantity" ? 1001 : 80, LineId = kind == "line" ? 999 : 1,
            PlanDate = kind == "holiday" ? "2030-01-13" : "2030-01-07" };
        if (kind == "closed") await factory.WithDbAsync(async db => { (await db.Orders.FindAsync(option.OrderId))!.Status = "completed"; await db.SaveChangesAsync(); });
        var addition = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, kind == "stale" ? "old-token" : option.Token, value);
        var response = await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([Change(existing, v => v with { PlannedQty = 90 })], Preview: false, Additions: [addition]));
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict });
        Assert.Equal(existing.Values.PlannedQty, (await Rows()).Single(r => r.Id == existing.Id).Values.PlannedQty);
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(p => p.OrderId == option.OrderId)));
    }

    [Fact]
    public async Task NewOnlyBatchCanUseRemainingDemand_AndOffsetFutureWhenAlreadyFullyScheduled()
    {
        var option = await NewProductOption();
        var value = new WorkbenchValues("2030-01-07", 1, 80, 1, 8, [], "");
        var addition = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, option.Token, value);
        var request = new WorkbenchRequest([], AutoDeduct: true, Additions: [addition]);
        var response = await client.PostAsJsonAsync("/api/plans/workbench", request); response.EnsureSuccessStatusCode();
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>(); Assert.Empty(preview.GetProperty("transfers").EnumerateArray());
        (await client.PostAsJsonAsync("/api/plans/workbench", request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            db.ProductionPlans.Add(new ProductionPlan { OrderId = option.OrderId, LineId = 1, PartName = option.PartName, SourcePartId = option.SourcePartId, Craft = "移印", PlanDate = Day.AddDays(1), PlannedQty = 920 });
            await db.SaveChangesAsync();
        });
        option = (await client.GetFromJsonAsync<List<WorkbenchOption>>("/api/plans/workbench/options"))!.Single();
        request = request with { Additions = [addition with { OptionToken = option.Token }] };
        response = await client.PostAsJsonAsync("/api/plans/workbench", request); response.EnsureSuccessStatusCode();
        preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(80, Assert.Single(preview.GetProperty("transfers").EnumerateArray()).GetProperty("quantity").GetInt32());
        (await client.PostAsJsonAsync("/api/plans/workbench", request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() })).EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.Equal(1000, await db.ProductionPlans.Where(p => p.OrderId == option.OrderId && p.DeletedAt == null).SumAsync(p => p.PlannedQty));
            Assert.All(await db.ProductionPlans.Where(p => p.OrderId == option.OrderId).ToListAsync(), p => Assert.True(p.Id > 0));
        });
    }

    [Fact]
    public async Task NewPlansRespectMaterialAvailabilityWithoutRewritingExistingPlans()
    {
        var option = await NewProductOption();
        await factory.WithDbAsync(async db => {
            db.OrderMaterials.Add(new OrderMaterial { OrderId = option.OrderId, PartName = option.PartName, ArrivedQty = 50, ExpectedDate = Day.AddDays(1) });
            await db.SaveChangesAsync();
        });
        var addition = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, option.Token, new("2030-01-07", 1, 80, 1, 8, [], ""));
        var snapshot = await ProtectedSnapshot();
        var response = await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([], Additions: [addition]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Contains("来料", await response.Content.ReadAsStringAsync());
        Assert.Equal(snapshot, await ProtectedSnapshot());
        await factory.WithDbAsync(async db => Assert.False(await db.ProductionPlans.AnyAsync(p => p.OrderId == option.OrderId)));
    }

    [Fact]
    public async Task NewMultiStepPlansMustIncludeUpstream_AndMultipleAdditionsCommitWithRealIds()
    {
        var option = await NewProductOption();
        await factory.WithDbAsync(async db => { (await db.ProductParts.SingleAsync(p => p.Id == option.SourcePartId)).CraftPasses = 2; await db.SaveChangesAsync(); });
        var options = (await client.GetFromJsonAsync<List<WorkbenchOption>>("/api/plans/workbench/options"))!.OrderBy(o => o.StepNo).ToList();
        var values = new WorkbenchValues("2030-01-07", 1, 80, 1, 8, [], "");
        var first = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, options[0].Token, values);
        var second = new WorkbenchAddition(-2, option.OrderPartQtyId, 2, options[1].Token, values with { PlanDate = "2030-01-08" });
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([], Additions: [second]))).StatusCode);
        var request = new WorkbenchRequest([], AutoDeduct: true, Additions: [first, second]);
        var response = await client.PostAsJsonAsync("/api/plans/workbench", request); response.EnsureSuccessStatusCode();
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        response = await client.PostAsJsonAsync("/api/plans/workbench", request with { Preview = false, AllocationToken = preview.GetProperty("allocationToken").GetString() });
        response.EnsureSuccessStatusCode();
        var saved = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, saved.GetProperty("createdPlanIds").GetArrayLength());
        Assert.All(saved.GetProperty("createdPlanIds").EnumerateArray(), mapping => Assert.True(mapping.GetProperty("planId").GetInt32() > 0));
        await factory.WithDbAsync(async db => Assert.Equal(2, await db.ProductionPlans.CountAsync(p => p.OrderId == option.OrderId)));
    }

    [Fact]
    public async Task NewProductCatalogIsFactoryScoped_AndNeverExposesClosedOrPendingOrders()
    {
        var option = await NewProductOption();
        await factory.WithDbAsync(async db => { (await db.Orders.FindAsync(option.OrderId))!.FactoryId = "HUADENG"; await db.SaveChangesAsync(); });
        Assert.Empty((await client.GetFromJsonAsync<List<WorkbenchOption>>("/api/plans/workbench/options"))!);
        var addition = new WorkbenchAddition(-1, option.OrderPartQtyId, 1, option.Token, new("2030-01-07", 1, 50, 1, 8, [], ""));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/plans/workbench", new WorkbenchRequest([], Preview: false, Additions: [addition]))).StatusCode);
    }

    async Task<WorkbenchOption> NewProductOption()
    {
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "NEW-PRODUCT", Parts = [new ProductPart { PartName = "临时部位", Craft = "移印", CraftPasses = 1 }] };
            db.Products.Add(product); await db.SaveChangesAsync();
            db.Orders.Add(new Order { ExternalOrderNo = "NEW-ORDER", ProductId = product.Id, Status = "received",
                PartQtys = [new() { PartName = "临时部位", SourcePartId = product.Parts[0].Id, Qty = 1000 }] });
            await db.SaveChangesAsync();
        });
        return Assert.Single((await client.GetFromJsonAsync<List<WorkbenchOption>>("/api/plans/workbench/options"))!);
    }

    [Fact]
    public async Task FactoryScopeAndPermissionsCannotBeBypassed()
    {
        await factory.WithDbAsync(async db => {
            var line = new ProductionLine { Name = "华登移印", FactoryId = "HUADENG" };
            db.ProductionPlans.Add(new ProductionPlan { FactoryId = "HUADENG", Line = line,
                Order = new Order { FactoryId = "HUADENG", ExternalOrderNo = "HD" }, PlanDate = Day, PlannedQty = 100 });
            await db.SaveChangesAsync();
        });
        Assert.DoesNotContain(await Rows(), r => r.OrderNo == "HD");
        var row = (await Rows()).First(r => r.LockedReason == null);
        Assert.Equal(HttpStatusCode.Conflict, (await Save([new WorkbenchChange(4, row.Token, row.Values)])).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "viewer", password = "viewer123" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/plans/workbench?from=2030-01-07&to=2030-01-08")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Save([Change(row, v => v with { PlannedQty = 90 })])).StatusCode);
    }
}
