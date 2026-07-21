using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 排期 / 产能换算纯函数 —— 对应现有 lib/schedule.ts（口径A：标准满产能，木桶取最慢）。
public static class ScheduleCalc
{
    // 部位某天产量 = 投入资源数 × 单台(单人)日产能
    public static int PartDailyOutput(int resourceCount, int dailyCapacity)
        => Math.Max(0, resourceCount) * Math.Max(0, dailyCapacity);

    // 部位剩余天数 = ceil(余下数 / 日产量)；日产量<=0 → null（无法估算）
    public static int? PartRemainingDays(int remainingQty, int dailyOutput)
    {
        if (dailyOutput <= 0) return null;
        if (remainingQty <= 0) return 0;
        return (int)Math.Ceiling((double)remainingQty / dailyOutput);
    }

    // 订单剩余天数 = MAX(各部位天数)；任一部位无法估 → null；空清单 → 0
    public static int? OrderRemainingDays(IEnumerable<(int RemainingQty, int ResourceCount, int DailyCapacity)> parts)
    {
        int max = 0;
        foreach (var p in parts)
        {
            var days = PartRemainingDays(p.RemainingQty, PartDailyOutput(p.ResourceCount, p.DailyCapacity));
            if (days is null) return null;
            if (days.Value > max) max = days.Value;
        }
        return max;
    }

    // 上车间日 = 所有已排 planDate 中最早一天（字典序=时间序）；无计划→null
    public static string? OrderFirstPlanDate(IEnumerable<string> planDates)
    {
        var list = planDates.ToList();
        if (list.Count == 0) return null;
        return list.OrderBy(x => x, StringComparer.Ordinal).First();
    }

    public static DateTime AddDays(DateTime date, int days) => date.AddDays(days);

    // Date → 'YYYY-MM-DD'（本地年月日，与 lib/schedule.ts toYmd 同款）
    public static string Ymd(DateTime d) => $"{d.Year:D4}-{d.Month:D2}-{d.Day:D2}";

    // 每周排期日期：本周一 + 填了排量的星期偏移(0=周一…6=周日) → 'YYYY-MM-DD' 列表
    public static List<string> WeeklyPlanDates(DateTime weekMonday, IEnumerable<int> dayOffsets)
        => dayOffsets.Select(off => Ymd(weekMonday.AddDays(off))).ToList();

    // 某子件总需求 = 该子件所有明细行各部位数量之和（不分颜色/规格）
    public static int SubItemTotalDemand(IEnumerable<OrderLine> lines, int sourceItemId)
        => lines.Where(l => l.SourceItemId == sourceItemId).Sum(l => l.PartQtys.Sum(q => q.Qty));

    // 可排部位（Craft=工艺大类：手喷/移印/自动喷/UV；IsTumbler=是否走炒货机）
    public record SchedulablePart(int SourceItemId, string ItemName, int SourcePartId, string PartName,
        string ProductionMode, int DailyCapacity, int StdMachineCount, int TotalDemand, string Craft, bool IsTumbler,
        int CraftPasses);

    // 把订单展开成「可排部位清单」：每个订单部位一项，需求=该部位订单数量，产能属性来自产品库部位。
    public static List<SchedulablePart> ExpandOrderParts(Order order)
    {
        var outl = new List<SchedulablePart>();
        foreach (var line in order.Lines)
        {
            var item = order.Product?.Items.FirstOrDefault(it => it.Id == line.SourceItemId);
            if (item is null) continue;
            foreach (var pq in line.PartQtys)
            {
                var part = item.Parts.FirstOrDefault(p => p.Id == pq.SourcePartId);
                if (part is null) continue;
                outl.Add(new SchedulablePart(item.Id, item.ItemName, part.Id, part.PartName,
                    part.ProductionMode, part.DailyCapacity, part.StdMachineCount, pq.Qty, part.Craft, part.IsTumbler,
                    part.CraftPasses));
            }
        }
        return outl;
    }

    // machineNos JSON 字符串 → 字符串数组（失败返回空），对应 scheduleData.ts safeArr
    public static List<string> SafeArr(string s)
    {
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(s) ?? new(); }
        catch { return new(); }
    }

    // 投入机台数：空数组或解析失败返回 1（至少 1，避免除 0），对应 safeLen
    public static int SafeLen(string s)
    {
        var a = SafeArr(s);
        return a.Count > 0 ? a.Count : 1;
    }
}
