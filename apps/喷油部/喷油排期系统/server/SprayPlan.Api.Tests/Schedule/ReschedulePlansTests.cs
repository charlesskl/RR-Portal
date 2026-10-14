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
}
