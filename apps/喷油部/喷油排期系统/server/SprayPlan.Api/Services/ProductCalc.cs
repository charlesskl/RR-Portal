using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 产品信息库成本聚合 —— 对应现有 lib/product.ts（综合成本=核+人工+油漆，部位无色加价）。
public static class ProductCalc
{
    public static double ComprehensiveCost(double unitCost, double laborPrice, double paintCost)
        => unitCost + laborPrice + paintCost;

    public static double SumUnitCost(IEnumerable<ProductPart> parts) => parts.Sum(p => p.UnitCost);

    public static double SumQuotedPrice(IEnumerable<ProductPart> parts) => parts.Sum(p => p.QuotedPrice);
}
