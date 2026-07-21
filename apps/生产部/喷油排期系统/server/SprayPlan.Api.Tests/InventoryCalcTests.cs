using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 对拍 spec §2.3 派生公式（纯函数，无 DB）
public class InventoryCalcTests
{
    [Fact]
    public void FinishedInStock_AddsCumulativeGoodAndNegativeOwnerMoves()
        // 累计良品 1200，出账 -950(装配) + -50(其它) = 200
        => Assert.Equal(200, InventoryCalc.FinishedInStock(1200, new[] { -950, -50 }));

    [Fact]
    public void FinishedInStock_NoMoves_EqualsCumulativeGood()
        => Assert.Equal(800, InventoryCalc.FinishedInStock(800, System.Array.Empty<int>()));

    [Fact]
    public void LooseAvailable_SumsLooseDeltas()
        // 散件入 +10 +5，被借 -3 → 12
        => Assert.Equal(12, InventoryCalc.LooseAvailable(new[] { 10, 5, -3 }));

    [Fact]
    public void PendingPickup_DemandMinusPicked()
        => Assert.Equal(250, InventoryCalc.PendingPickup(1000, 750));

    [Fact]
    public void ReorderAvailableInProduction_CaseA_Zero()
        // 案例A：成品50 待领250 → max(0,50-250)=0
        => Assert.Equal(0, InventoryCalc.ReorderAvailableInProduction(50, 250));

    [Fact]
    public void ReorderAvailableInProduction_CaseB_200()
        // 案例B：成品250 待领50 → 200
        => Assert.Equal(200, InventoryCalc.ReorderAvailableInProduction(250, 50));
}
