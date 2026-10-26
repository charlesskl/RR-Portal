using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

public class OrderCalcTests
{
    [Fact]
    public void ResizeDemand_PreservesRatiosAndDistributesRoundingForDuplicatePartNames()
    {
        var parts = new List<OrderPartQty> {
            new() { Id = 1, PartName = "头", Qty = 1 },
            new() { Id = 2, PartName = "头", Qty = 2 },
            new() { Id = 3, PartName = "脚", Qty = 6 },
            new() { Id = 4, PartName = "尾", Qty = 0 }
        };
        OrderCalc.ResizeDemand(parts, 10);
        Assert.Equal(new[] { 2, 3, 10, 0 }, parts.Select(part => part.Qty).ToArray());
        OrderCalc.ResizeDemand(parts, 1);
        Assert.Equal(1, parts.GroupBy(part => part.PartName).Max(group => group.Sum(part => part.Qty)));
        Assert.All(parts, part => Assert.True(part.Qty >= 0));
    }

    [Fact]
    public void ResizeDemand_ZeroDemand_InitializesEachPart()
    {
        var parts = new List<OrderPartQty> {
            new() { PartName = "头", Qty = 0 }, new() { PartName = "脚", Qty = 0 }
        };
        OrderCalc.ResizeDemand(parts, 100);
        Assert.All(parts, part => Assert.Equal(100, part.Qty));
    }

    [Fact]
    public void OrderTotalQty_SumsAllPartQtys()
    {
        var partQtys = new List<OrderPartQty> { new() { Qty = 3 }, new() { Qty = 4 }, new() { Qty = 5 } };
        Assert.Equal(12, OrderCalc.OrderTotalQty(partQtys));
    }

    [Fact]
    public void RemainingQty_UsesSlowestStepAndIgnoresDeletedPlansAndOverproduction()
    {
        var order = new Order {
            PartQtys = new() { new() { PartName = "头", Qty = 100 }, new() { PartName = "脚", Qty = 100 } },
            Plans = new() {
                new() { PartName = "头", StepNo = 1, GoodQty = 80 },
                new() { PartName = "头", StepNo = 2, GoodQty = 30 },
                new() { PartName = "头", StepNo = 2, GoodQty = 60, DeletedAt = DateTime.UtcNow },
                new() { PartName = "脚", GoodQty = 120 }
            }
        };
        Assert.Equal(70, OrderCalc.RemainingQty(order));
    }

    [Fact]
    public void PartComprehensivePrice_SumsThreePrices()
        => Assert.Equal(6.0, OrderCalc.PartComprehensivePrice(1, 2, 3));

    [Fact]
    public void LineUnitPrice_SumsAllPartPrices()
    {
        var parts = new List<ProductPart>
        {
            new() { PartName = "头", UnitCost = 1, LaborPrice = 1, PaintCost = 1 },
            new() { PartName = "脚", UnitCost = 2, LaborPrice = 0, PaintCost = 0 },
        };
        Assert.Equal(5.0, OrderCalc.LineUnitPrice(parts));
    }
}
