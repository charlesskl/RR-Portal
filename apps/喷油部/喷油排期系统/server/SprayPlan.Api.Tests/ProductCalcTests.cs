using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests;

// 对拍 lib/product.ts 的聚合算法
public class ProductCalcTests
{
    [Fact]
    public void ComprehensiveCost_SumsThreeCosts()
        => Assert.Equal(6.0, ProductCalc.ComprehensiveCost(1, 2, 3));

    [Fact]
    public void SumUnitCost_AddsAllParts()
    {
        var parts = new List<ProductPart> { new() { UnitCost = 1.5 }, new() { UnitCost = 2.5 } };
        Assert.Equal(4.0, ProductCalc.SumUnitCost(parts));
    }

    [Fact]
    public void SumQuotedPrice_AddsAllParts()
    {
        var parts = new List<ProductPart> { new() { QuotedPrice = 10 }, new() { QuotedPrice = 5 } };
        Assert.Equal(15.0, ProductCalc.SumQuotedPrice(parts));
    }
}
