using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 订单数量/价格聚合 —— 对应现有 lib/order.ts。
// 订单按部位填数量；基础工价从产品库部位带出（不分颜色/规格，无特殊色加价）。
public static class OrderCalc
{
    // 行合计：某明细行（子件）所有部位数量之和
    public static int LineTotalQty(IEnumerable<OrderPartQty> partQtys) => partQtys.Sum(q => q.Qty);

    // 整单总数：各行各部位数量之和
    public static int OrderTotalQty(IEnumerable<OrderPartQty> partQtys) => partQtys.Sum(q => q.Qty);

    // 各部位剩余数合计；多工序按最少完成量计算，软删计划不参与。
    public static int RemainingQty(Order order) => order.PartQtys.GroupBy(q => q.PartName).Sum(group =>
    {
        var demand = group.Sum(q => q.Qty);
        var steps = order.Plans.Where(p => p.DeletedAt == null && p.PartName == group.Key)
            .GroupBy(p => p.StepNo).Select(step => step.Sum(p => p.GoodQty ?? 0)).ToList();
        return Math.Max(0, demand - (steps.Count == 0 ? 0 : steps.Min()));
    });

    // 部位单件综合价 = 核 + 人工 + 油漆
    public static double PartComprehensivePrice(double unitCost, double laborPrice, double paintCost)
        => unitCost + laborPrice + paintCost;

    // 某子件单件综合价 = Σ 各部位(核+人工+油漆)
    public static double LineUnitPrice(IEnumerable<ProductPart> parts)
        => parts.Sum(p => PartComprehensivePrice(p.UnitCost, p.LaborPrice, p.PaintCost));
}
