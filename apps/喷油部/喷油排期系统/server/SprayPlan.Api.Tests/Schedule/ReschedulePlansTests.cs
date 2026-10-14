using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;
public class ReschedulePlansTests
{
    [Theory]
    [InlineData(false, false, false, 200)]
    [InlineData(true, false, false, 400)]
    [InlineData(false, true, false, 409)]
    [InlineData(false, false, true, 400)]
    public async Task DateChanges_AreAtomicAndProtectActuals(bool recorded, bool stale, bool archived, int expected)
    {
        using var factory = new ApiFactory();
        await factory.SeedAsync();
        using var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        var ids = new List<int>();
        var original = new DateTime(2026, 10, 14, 0, 0, 0, DateTimeKind.Utc);
        await factory.WithDbAsync(async db => {
            var order = new Order { ExternalOrderNo = "MOVE", Status = archived ? "archived" : "scheduled", OrderDate = original };
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            var rows = new[] {
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = original, PlannedQty = 100 },
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "脚", PlanDate = original, PlannedQty = 200, GoodQty = recorded ? 0 : null }
            };
            db.ProductionPlans.AddRange(rows); await db.SaveChangesAsync(); ids.AddRange(rows.Select(p => p.Id));
        });
        var response = await client.PostAsJsonAsync("/api/plans/reschedule", new {
            changes = ids.Select(id => new { id, originalDate = stale ? "2026-10-13" : "2026-10-14", newDate = "2026-10-16" }), reason = "缺料"
        });
        Assert.Equal((HttpStatusCode)expected, response.StatusCode);
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync();
            Assert.All(plans, p => {
                Assert.Equal(expected == 200 ? original.AddDays(2) : original, p.PlanDate);
                Assert.Equal(p.PartName == "头" ? 100 : 200, p.PlannedQty);
                if (expected == 200) {
                    var history = JsonSerializer.Deserialize<JsonElement>(p.ModificationHistory);
                    Assert.Equal("2026-10-14", history[0].GetProperty("oldValue").GetString());
                    Assert.Equal("2026-10-16", history[0].GetProperty("newValue").GetString());
                    Assert.Equal("缺料", history[0].GetProperty("reason").GetString());
                } else Assert.Equal("[]", p.ModificationHistory);
            });
        });
    }

    private static readonly DateTime OriginalDate = new(2026, 10, 14, 0, 0, 0, DateTimeKind.Utc);

    private static async Task<List<int>> SeedPlans(ApiFactory factory, Action<Order, ProductionPlan>? alter = null)
    {
        var ids = new List<int>();
        await factory.WithDbAsync(async db => {
            var order = new Order {
                ExternalOrderNo = "MOVE-BOUNDARY", Status = "scheduled", OrderDate = OriginalDate,
                PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 200 } }
            };
            db.Orders.Add(order); await db.SaveChangesAsync();
            var plans = new[] {
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "头", PlanDate = OriginalDate, PlannedQty = 100, MachineNos = "[\"5#\"]", WorkerCount = 3, Craft = "移印" },
                new ProductionPlan { OrderId = order.Id, LineId = 1, PartName = "脚", PlanDate = OriginalDate, PlannedQty = 200, MachineNos = "[\"5#\"]", WorkerCount = 4, Craft = "手喷" }
            };
            alter?.Invoke(order, plans[1]);
            db.ProductionPlans.AddRange(plans); await db.SaveChangesAsync(); ids.AddRange(plans.Select(p => p.Id));
        });
        return ids;
    }

    private static async Task Login(HttpClient client, string username = "clerk")
        => (await client.PostAsJsonAsync("/api/auth/login", new { username, password = username + "123" })).EnsureSuccessStatusCode();

    private static object Request(IEnumerable<int> ids, string next = "2026-10-16")
        => new { changes = ids.Select(id => new { id, originalDate = "2026-10-14", newDate = next }), reason = "缺料" };

    [Theory]
    [InlineData("recorded")]
    [InlineData("good-zero")]
    [InlineData("inbound-zero")]
    [InlineData("reported-zero")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task Qualification_MatchesBothListsAndRejectsWholeBatchAndSingleDateChange(string blocked)
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient(); await Login(client);
        var ids = await SeedPlans(factory, (order, plan) => {
            switch (blocked) {
                case "recorded": plan.Status = "recorded"; break;
                case "good-zero": plan.GoodQty = 0; break;
                case "inbound-zero": plan.InboundQty = 0; break;
                case "reported-zero": plan.ReportedQty = 0; break;
                default: order.Status = blocked; break;
            }
        });
        var list = await client.GetFromJsonAsync<JsonElement>("/api/plans");
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/schedule/overview?from=2026-10-01&to=2026-10-31");
        Assert.False(list.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == ids[1]).GetProperty("canReschedule").GetBoolean());
        Assert.False(overview.GetProperty("plans").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == ids[1]).GetProperty("canReschedule").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/plans/reschedule", Request(ids))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsJsonAsync($"/api/plans/{ids[1]}", new { planDate = "2026-10-16" })).StatusCode);
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync();
            Assert.All(plans, p => { Assert.Equal(OriginalDate, p.PlanDate); Assert.Equal("[]", p.ModificationHistory); });
        });
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("viewer", 403)]
    [InlineData("admin", 200)]
    public async Task Authorization_PreservesExistingRoles(string? username, int status)
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient();
        var ids = await SeedPlans(factory);
        if (username is not null) await Login(client, username);
        Assert.Equal((HttpStatusCode)status, (await client.PostAsJsonAsync("/api/plans/reschedule", Request(ids))).StatusCode);
        await factory.WithDbAsync(async db => {
            Assert.All(await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync(),
                p => Assert.Equal(status == 200 ? OriginalDate.AddDays(2) : OriginalDate, p.PlanDate));
        });
    }

    [Theory]
    [InlineData("null-list")]
    [InlineData("null-change")]
    [InlineData("empty")]
    [InlineData("duplicate")]
    [InlineData("invalid-date")]
    [InlineData("time-in-date")]
    public async Task InvalidBatch_Is400WithoutAnyWrites(string input)
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient(); await Login(client);
        var ids = await SeedPlans(factory);
        object request = input switch {
            "null-list" => new { changes = (object?)null },
            "null-change" => new { changes = new object?[] { new { id = ids[0], originalDate = "2026-10-14", newDate = "2026-10-16" }, null } },
            "empty" => Request(Array.Empty<int>()),
            "duplicate" => Request(new[] { ids[0], ids[0] }),
            "invalid-date" => Request(ids, "2026-02-30"),
            _ => Request(ids, "2026-10-16T00:00:00Z")
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/plans/reschedule", request)).StatusCode);
        await factory.WithDbAsync(async db => {
            Assert.All(await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync(),
                p => { Assert.Equal(OriginalDate, p.PlanDate); Assert.Equal("[]", p.ModificationHistory); });
        });
    }

    [Theory]
    [InlineData("deleted")]
    [InlineData("missing")]
    [InlineData("other-factory")]
    public async Task MissingOrOutOfScopePlan_DoesNotMoveValidRow(string blocked)
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient(); await Login(client);
        var ids = await SeedPlans(factory, (_, p) => {
            if (blocked == "deleted") p.DeletedAt = DateTime.UtcNow;
            if (blocked == "other-factory") p.FactoryId = "HUADENG";
        });
        var submitted = blocked == "missing" ? new[] { ids[0], int.MaxValue } : ids.ToArray();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/plans/reschedule", Request(submitted))).StatusCode);
        await factory.WithDbAsync(async db => {
            Assert.All(await db.ProductionPlans.IgnoreQueryFilters().Where(p => ids.Contains(p.Id)).ToListAsync(),
                p => { Assert.Equal(OriginalDate, p.PlanDate); Assert.Equal("[]", p.ModificationHistory); });
        });
    }

    [Fact]
    public async Task ConcurrentSameOriginalDate_OneSucceedsAndOneConflicts()
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient(); await Login(client);
        var ids = await SeedPlans(factory);
        var responses = await Task.WhenAll(
            client.PostAsJsonAsync("/api/plans/reschedule", Request(ids, "2026-10-16")),
            client.PostAsJsonAsync("/api/plans/reschedule", Request(ids, "2026-10-17")));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync();
            Assert.Single(plans.Select(p => p.PlanDate).Distinct());
            Assert.All(plans, p => Assert.Single(JsonSerializer.Deserialize<JsonElement>(p.ModificationHistory).EnumerateArray()));
        });
    }

    [Fact]
    public async Task SuccessfulMove_PreservesResourcesAndRefreshesScheduleFinishDate()
    {
        using var factory = new ApiFactory(); await factory.SeedAsync();
        using var client = factory.CreateClient(); await Login(client);
        var ids = await SeedPlans(factory);
        var before = await client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        Assert.Equal("2026-10-14", before[0].GetProperty("scheduleFinishDate").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/plans/reschedule", Request(ids))).StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/orders/overview");
        Assert.Equal("2026-10-16", after[0].GetProperty("scheduleFinishDate").GetString());
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/schedule/overview?from=2026-10-01&to=2026-10-31");
        Assert.All(overview.GetProperty("plans").EnumerateArray(), p => {
            Assert.True(p.GetProperty("canReschedule").GetBoolean());
            Assert.Equal("2026-10-16", p.GetProperty("date").GetString());
        });
        await factory.WithDbAsync(async db => {
            var plans = await db.ProductionPlans.Where(p => ids.Contains(p.Id)).ToListAsync();
            Assert.All(plans, p => {
                Assert.Equal("[\"5#\"]", p.MachineNos); Assert.Equal(1, p.LineId); Assert.Equal(1, p.StepNo);
                Assert.Equal(p.PartName == "头" ? 100 : 200, p.PlannedQty);
                Assert.Equal(p.PartName == "头" ? 3 : 4, p.WorkerCount);
                Assert.Equal(p.PartName == "头" ? "移印" : "手喷", p.Craft);
                Assert.Null(p.GoodQty); Assert.Null(p.InboundQty); Assert.Null(p.ReportedQty); Assert.Equal("planned", p.Status);
                Assert.Equal("clerk", p.LastModifiedBy); Assert.True(p.LastModifiedAt > OriginalDate);
            });
            var order = await db.Orders.SingleAsync();
            Assert.Equal("scheduled", order.Status); Assert.Equal("clerk", order.LastUpdatedBy);
        });
    }
}
