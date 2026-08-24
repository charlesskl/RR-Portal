using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

public class ExpandOrderPartsTests
{
    [Fact]
    public void Expand_CarriesCraftAndTumbler()
    {
        var part = new ProductPart { Id = 10, ProductId = 1, PartName = "头", Craft = "手喷", IsTumbler = true, DailyCapacity = 800, StdMachineCount = 1 };
        var order = new Order { Product = new Product { Id = 1, Parts = { part } }, PartQtys = { new OrderPartQty { SourcePartId = 10, Qty = 800 } } };
        var parts = ScheduleCalc.ExpandOrderParts(order);
        Assert.Single(parts);
        Assert.Equal("手喷", parts[0].Craft);
        Assert.True(parts[0].IsTumbler);
    }

    [Fact]
    public void Expand_SamePartGroup_ReturnsEveryProcessWithoutDuplicatingDemand()
    {
        var product = new Product { Id = 2, Parts = {
            new ProductPart { Id = 850, ProductId = 2, PartGroupId = 850, PartName = "大身", Craft = "移印", CraftPasses = 4 },
            new ProductPart { Id = 853, ProductId = 2, PartGroupId = 850, PartName = "大身", Craft = "手喷", CraftPasses = 4 },
        } };
        var order = new Order { Product = product, PartQtys = { new OrderPartQty { SourcePartId = 850, Qty = 6000 } } };
        var parts = ScheduleCalc.ExpandOrderParts(order);
        Assert.Equal(2, parts.Count);
        Assert.All(parts, p => Assert.Equal(850, p.PartGroupId));
        Assert.All(parts, p => Assert.Equal(6000, p.TotalDemand));
        Assert.Equal(new[] { "移印", "手喷" }, parts.Select(p => p.Craft).ToArray());
    }

    [Fact]
    public void PartProcessRules_ExpandsInHandAutoPrintUvOrder()
    {
        var parts = new[] { new ProductPart { Craft = "UV", CraftPasses = 5 }, new ProductPart { Craft = "移印", CraftPasses = 5 }, new ProductPart { Craft = "自动喷", CraftPasses = 5 }, new ProductPart { Craft = "手喷", CraftPasses = 5 } };
        Assert.Equal(new[] { "手喷", "自动喷", "移印", "UV", "手喷" }, PartProcessRules.ExpandPasses(parts).Select(p => p.Craft).ToArray());
    }
}
