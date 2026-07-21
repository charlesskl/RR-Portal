using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 对拍 lib/order.ts 的数量/价格聚合（部位级，无特殊色加价）
public class OrderCalcTests
{
    [Fact]
    public void OrderTotalQty_SumsAllPartQtys()
    {
        var lines = new List<OrderLine>
        {
            new() { PartQtys = new() { new() { Qty = 3 }, new() { Qty = 4 } } },
            new() { PartQtys = new() { new() { Qty = 5 } } },
        };
        Assert.Equal(12, OrderCalc.OrderTotalQty(lines));
    }

    [Fact]
    public void PartComprehensivePrice_SumsThreePrices()
        => Assert.Equal(6.0, OrderCalc.PartComprehensivePrice(1, 2, 3));

    [Fact]
    public void LineUnitPrice_SumsAllPartPrices()
    {
        var parts = new List<ProductPart>
        {
            new() { PartName = "头", UnitCost = 1, LaborPrice = 1, PaintCost = 1 },  // 3
            new() { PartName = "脚", UnitCost = 2, LaborPrice = 0, PaintCost = 0 },  // 2
        };
        // 头 3 + 脚 2 = 5
        Assert.Equal(5.0, OrderCalc.LineUnitPrice(parts));
    }
}
