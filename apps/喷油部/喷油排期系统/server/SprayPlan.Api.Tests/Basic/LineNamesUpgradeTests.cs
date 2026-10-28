using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

public class LineNamesUpgradeTests
{
    [Theory]
    [InlineData("A拉：自动喷", "B拉：手喷")]
    [InlineData("A拉", "B拉")]
    public async Task RenamePreservesResourcesAndPlans_AndIsIdempotent(string autoName, string handName)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var auto = new ProductionLine { Name = autoName, CraftType = "自动喷", DailyCapacityLimit = 300000 };
        var hand = new ProductionLine { Name = handName, CraftType = "手喷", DailyCapacityLimit = 200000 };
        var otherFactory = new ProductionLine { Name = autoName, CraftType = "自动喷", FactoryId = "HUADENG" };
        var custom = new ProductionLine { Name = "自定义喷油拉", CraftType = "手喷" };
        db.AddRange(auto, hand, otherFactory, custom);
        var machine = new Machine { Line = auto, MachineNo = "1#", MachineType = "自动喷" };
        var plan = new ProductionPlan {
            Line = auto, Order = new Order { ExternalOrderNo = "rename-test" },
            PlanDate = new DateTime(2026, 10, 27, 0, 0, 0, DateTimeKind.Utc), PlannedQty = 10000,
            GoodQty = 9000, InboundQty = 8000, Status = "recorded", MachineNos = "[\"1#\"]",
        };
        db.AddRange(machine, plan);
        await db.SaveChangesAsync();
        var autoId = auto.Id;
        var handId = hand.Id;

        await LineNamesUpgrade.Ensure(db);
        await LineNamesUpgrade.Ensure(db);
        db.ChangeTracker.Clear();

        var lines = await db.ProductionLines.Where(l => l.FactoryId == "XINGXIN").OrderBy(l => l.Name).ToListAsync();
        Assert.Equal(new[] { "A拉：手喷", "B拉：自动喷", "自定义喷油拉" }, lines.Select(l => l.Name));
        Assert.Equal(handId, lines[0].Id);
        Assert.Equal("手喷", lines[0].CraftType);
        Assert.Equal(200000, lines[0].DailyCapacityLimit);
        Assert.Equal(autoId, lines[1].Id);
        Assert.Equal("自动喷", lines[1].CraftType);
        Assert.Equal(300000, lines[1].DailyCapacityLimit);
        Assert.Equal(autoName, (await db.ProductionLines.IgnoreQueryFilters().SingleAsync(l => l.Id == otherFactory.Id)).Name);
        var savedMachine = await db.Machines.SingleAsync();
        Assert.Equal(autoId, savedMachine.LineId);
        Assert.Equal("自动喷", savedMachine.MachineType);
        var savedPlan = await db.ProductionPlans.SingleAsync();
        Assert.Equal(autoId, savedPlan.LineId);
        Assert.Equal(plan.PlanDate, savedPlan.PlanDate);
        Assert.Equal(10000, savedPlan.PlannedQty);
        Assert.Equal(9000, savedPlan.GoodQty);
        Assert.Equal(8000, savedPlan.InboundQty);
        Assert.Equal("recorded", savedPlan.Status);
        Assert.Equal(plan.MachineNos, savedPlan.MachineNos);
    }

    [Fact]
    public async Task EmptyDatabaseCanStartBeforeTablesExist()
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite("Data Source=:memory:").Options);
        await LineNamesUpgrade.Ensure(db);
    }
}
