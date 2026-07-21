using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

public class ExpandOrderPartsTests
{
    [Fact]
    public void Expand_CarriesCraftAndTumbler()
    {
        // 构造一个含 1 个子件、1 个部位的产品，部位带工艺 "手喷" + 炒货机 true
        var item = new ProductItem
        {
            Id = 1,
            ItemName = "兔子",
            Parts =
            {
                new ProductPart
                {
                    Id = 10,
                    PartName = "头",
                    Craft = "手喷",
                    IsTumbler = true,
                    DailyCapacity = 800,
                    StdMachineCount = 1
                }
            }
        };

        // 构造订单：Lines 勾选 SourceItemId=1，PartQtys 含部位 10 数量 800
        var order = new Order
        {
            Id = 1,
            Product = new Product
            {
                Items = { item }
            },
            Lines =
            {
                new OrderLine
                {
                    SourceItemId = 1,
                    PartQtys =
                    {
                        new OrderPartQty { SourcePartId = 10, Qty = 800 }
                    }
                }
            }
        };

        var parts = ScheduleCalc.ExpandOrderParts(order);

        Assert.Single(parts);
        Assert.Equal("手喷", parts[0].Craft);
        Assert.True(parts[0].IsTumbler);
    }
}
