using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using System.Text.Json;

namespace SprayPlan.Api.Services;

public sealed class ProductionCalendar(IEnumerable<Holiday> holidays)
{
    private readonly Dictionary<DateTime, string> overrides = holidays.GroupBy(h => h.Date.Date).ToDictionary(g => g.Key, g => g.Last().Type);
    public bool IsWorkday(DateTime day) => overrides.TryGetValue(day.Date, out var type) ? type == "workday" : day.DayOfWeek != DayOfWeek.Sunday;
    public DateTime NextWorkday(DateTime day)
    {
        while (!IsWorkday(day)) day = day.AddDays(1);
        return day;
    }

    // 同一订单、部位、工序、拉别按原日期顺序移动，后续计划不挤占同一天。
    // 有实绩或已过日期的计划保持原样。节假日和重排在同一事务中保存。
    public static async Task<int> Reflow(AppDbContext db, string by)
    {
        var calendar = new ProductionCalendar(await db.Holidays.AsNoTracking().ToListAsync());
        var today = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date, DateTimeKind.Utc);
        var plans = await db.ProductionPlans.Include(p => p.Order)
            .Where(p => p.DeletedAt == null && p.PlanDate >= today && p.GoodQty == null && p.InboundQty == null && p.ReportedQty == null && p.Status != "recorded"
                && p.Order != null && p.Order.Status != "completed" && p.Order.Status != "archived").ToListAsync();
        var count = 0;
        foreach (var chain in plans.GroupBy(p => new { p.OrderId, p.PartName, p.StepNo, p.LineId }))
        {
            DateTime? previous = null;
            foreach (var day in chain.GroupBy(p => p.PlanDate).OrderBy(g => g.Key))
            {
                var next = calendar.NextWorkday(previous.HasValue && day.Key <= previous.Value ? previous.Value.AddDays(1) : day.Key);
                previous = next;
                foreach (var plan in day)
                {
                    if (next == plan.PlanDate) continue;
                    var history = JsonSerializer.Deserialize<List<JsonElement>>(plan.ModificationHistory) ?? new();
                    history.Add(JsonSerializer.SerializeToElement(new { field = "planDate", oldValue = ScheduleCalc.Ymd(plan.PlanDate), newValue = ScheduleCalc.Ymd(next), reason = "工作日历调整自动顺延", by, at = DateTime.UtcNow }));
                    plan.ModificationHistory = JsonSerializer.Serialize(history);
                    plan.PlanDate = next; plan.LastModifiedBy = by; plan.LastModifiedAt = DateTime.UtcNow;
                    plan.Order!.LastUpdatedBy = by; plan.Order.UpdatedAt = DateTime.UtcNow;
                    count++;
                }
            }
        }
        await db.SaveChangesAsync();
        return count;
    }
}
