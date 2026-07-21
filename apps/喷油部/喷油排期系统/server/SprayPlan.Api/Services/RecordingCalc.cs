namespace SprayPlan.Api.Services;

// 实绩：产值 / 余下数 / 完工判定 纯函数 —— 对应现有 lib/recording.ts。
public static class RecordingCalc
{
    // 部位综合工价(成本侧) = 核 + 人工 + 油漆 + 特殊色加价
    public static double PartUnitPrice(double unitCost, double laborPrice, double paintCost, double specialUpcharge = 0)
        => unitCost + laborPrice + paintCost + specialUpcharge;

    // 产值 = 生产数 × 综合工价；任一 ≤ 0 兜底 0
    public static double ProductionValue(int goodQty, double unitPrice)
        => (goodQty <= 0 || unitPrice <= 0) ? 0 : goodQty * unitPrice;

    // 部位累计已录良品 = Σ goodQty（null 按 0）
    public static int PartRecordedTotal(IEnumerable<int?> goodQtys) => goodQtys.Sum(q => q ?? 0);

    // 车间存数（按"产品+部位"维度由调用方分组后传入）= Σ员工报数 − Σ入库数(良品)。
    // 不兜底为正：负值可暴露对账异常，由调用方决定展示。
    public static int WorkshopStock(IEnumerable<int?> reportedQtys, IEnumerable<int?> goodQtys)
        => reportedQtys.Sum(q => q ?? 0) - goodQtys.Sum(q => q ?? 0);

    // 部位余下数 = 总需求 − 累计已录，最小 0
    public static int PartRemainingQty(int totalDemand, int recorded) => Math.Max(0, totalDemand - recorded);

    // 部位完工：需求 > 0 且累计已录 ≥ 需求
    public static bool IsPartComplete(int totalDemand, int recorded) => totalDemand > 0 && recorded >= totalDemand;

    // 订单完工(木桶)：非空且每个部位都完工
    public static bool IsOrderComplete(IEnumerable<(int Demand, int Recorded)> parts)
    {
        var list = parts.ToList();
        return list.Count > 0 && list.All(p => IsPartComplete(p.Demand, p.Recorded));
    }
}
