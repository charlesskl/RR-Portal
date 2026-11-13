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
