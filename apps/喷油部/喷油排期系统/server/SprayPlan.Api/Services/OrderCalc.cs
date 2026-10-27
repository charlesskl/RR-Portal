using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

public record PartScheduleBalance(string PartName, int StepNo, string Craft, long DemandQty,
    long RecordedQty, long PendingQty, long SupplementQty, long ReduceQty, long OverproducedQty);

// 订单数量/价格聚合 —— 对应现有 lib/order.ts。
// 订单按部位填数量；基础工价从产品库部位带出（不分颜色/规格，无特殊色加价）。
public static class OrderCalc
{
    // 每道工序分别比较：需求 vs 已生产 + 尚未报工的计划量。
    // 已报工计划以实绩计入，避免原计划数掩盖少生产的缺口；减排仅针对未报工计划。
    public static List<PartScheduleBalance> ScheduleBalances(IEnumerable<OrderPartQty> parts, IEnumerable<ProductionPlan> sourcePlans, ISet<int>? inboundSources = null)
    {
        var plans = sourcePlans.Where(plan => plan.DeletedAt is null).ToList();
        var result = new List<PartScheduleBalance>();
        foreach (var part in parts.GroupBy(part => part.PartName))
        {
            var demand = part.Sum(part => (long)part.Qty);
            var steps = plans.Where(plan => plan.PartName == part.Key).GroupBy(plan => plan.StepNo).OrderBy(step => step.Key).ToList();
            if (steps.Count == 0)
            {
                result.Add(new(part.Key, 0, "未排期", demand, 0, 0, demand, 0, 0));
                continue;
            }
            foreach (var step in steps)
            {
                var recorded = step.Sum(plan => (long)(plan.GoodQty ?? 0));
                var pending = step.Where(plan => !PlanDateRules.HasActuals(plan) && inboundSources?.Contains(plan.Id) != true).Sum(plan => (long)plan.PlannedQty);
                result.Add(new(part.Key, step.Key,
                    string.Join("/", step.Select(plan => plan.Craft).Where(craft => !string.IsNullOrWhiteSpace(craft)).Distinct()),
                    demand, recorded, pending, Math.Max(0, demand - recorded - pending),
                    Math.Min(pending, Math.Max(0, recorded + pending - demand)), Math.Max(0, recorded - demand)));
            }
        }
        return result;
    }

    // 保留部位间的数量比例。同名明细按余数分配，确保取整后总量仍准确。
    public static void ResizeDemand(List<OrderPartQty> parts, int totalQty)
    {
        var groups = parts.GroupBy(part => part.PartName).ToList();
        var previousTotal = groups.Select(group => group.Sum(part => (long)part.Qty)).DefaultIfEmpty(0).Max();
        foreach (var group in groups)
        {
            var quantity = group.Sum(part => (long)part.Qty);
            var target = previousTotal > 0
                ? (int)Math.Round((decimal)quantity * totalQty / previousTotal, MidpointRounding.AwayFromZero)
                : totalQty;
            var allocations = group.OrderBy(part => part.Id).Select(part => new
            {
                Part = part,
                Exact = quantity > 0 ? (decimal)part.Qty * target / quantity : (decimal)target / group.Count()
            }).ToList();
            foreach (var item in allocations) item.Part.Qty = (int)decimal.Floor(item.Exact);
            var remainder = target - allocations.Sum(item => item.Part.Qty);
            foreach (var item in allocations.OrderByDescending(item => item.Exact - decimal.Floor(item.Exact)).Take(remainder))
                item.Part.Qty++;
        }
    }

    // 数量更正沿用撤销实绩后的状态推导，只读取计划/实绩，不改动这些记录。
    public static string DemandStatus(string currentStatus, IEnumerable<OrderPartQty> parts, IEnumerable<ProductionPlan> sourcePlans)
    {
        var plans = sourcePlans.Where(plan => plan.DeletedAt is null).ToList();
        if (plans.Count == 0) return currentStatus == "draft" ? "draft" : "received";
        if (!plans.Any(PlanDateRules.HasActuals)) return "scheduled";

        var demand = parts.GroupBy(part => part.PartName)
            .Select(group => new { Name = group.Key, Qty = group.Sum(part => (long)part.Qty) })
            .Where(part => part.Qty > 0).ToList();
        var complete = demand.Count > 0 && demand.All(part => {
            var steps = plans.Where(plan => plan.PartName == part.Name)
                .GroupBy(plan => plan.StepNo)
                .Select(step => step.Sum(plan => (long)(plan.GoodQty ?? 0))).ToList();
            return steps.Count > 0 && steps.Min() >= part.Qty;
        });
        return complete ? "completed" : "in_production";
    }

    // 行合计：某明细行（子件）所有部位数量之和
    public static int LineTotalQty(IEnumerable<OrderPartQty> partQtys) => partQtys.Sum(q => q.Qty);

    // 整单总数：各行各部位数量之和
    public static int OrderTotalQty(IEnumerable<OrderPartQty> partQtys) => partQtys.Sum(q => q.Qty);

    // 各部位独立计算欠数，再取最大值；兼容不同部位需求不相同的订单。
    // 同部位多工序取最少累计实绩，软删计划不参与，欠数不低于 0。
    public static int RemainingQty(Order order)
    {
        var demand = order.PartQtys.GroupBy(q => q.PartName)
            .Where(group => group.Sum(q => q.Qty) > 0)
            .ToDictionary(group => group.Key, group => group.Sum(q => q.Qty));
        if (demand.Count == 0) return 0;
        return demand.Select(part =>
        {
            var steps = order.Plans.Where(p => p.DeletedAt == null && p.PartName == part.Key)
                .GroupBy(p => p.StepNo).Select(step => step.Sum(p => p.GoodQty ?? 0)).ToList();
            var completed = steps.Count == 0 ? 0 : Math.Min(part.Value, steps.Min());
            return Math.Max(0, part.Value - completed);
        }).Max();
    }

    // 部位单件综合价 = 核 + 人工 + 油漆
    public static double PartComprehensivePrice(double unitCost, double laborPrice, double paintCost)
        => unitCost + laborPrice + paintCost;

    // 某子件单件综合价 = Σ 各部位(核+人工+油漆)
    public static double LineUnitPrice(IEnumerable<ProductPart> parts)
        => parts.Sum(p => PartComprehensivePrice(p.UnitCost, p.LaborPrice, p.PaintCost));
}
