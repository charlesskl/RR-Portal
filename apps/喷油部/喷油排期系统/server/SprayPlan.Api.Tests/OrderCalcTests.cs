using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

public class OrderCalcTests
{
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
