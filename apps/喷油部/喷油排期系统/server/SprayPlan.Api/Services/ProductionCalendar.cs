using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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

    // holidays 是两厂共用配置。仅配置写接口可在其既有事务中使用维护上下文，
    // 复用同一连接和事务，避免扩大普通业务查询/写入的厂区权限。
    internal static async Task<int> ReflowSharedCalendar(AppDbContext db, string by)
    {
        var transaction = db.Database.CurrentTransaction
            ?? throw new InvalidOperationException("共享日历重排必须与配置变更处于同一事务");
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(db.Database.GetDbConnection()).Options;
        await using var shared = new AppDbContext(options);
        await shared.Database.UseTransactionAsync(transaction.GetDbTransaction());
        return await Reflow(shared, by);
    }

    // 同一订单、部位、工序、拉别按原日期顺序移动，后续计划不挤占同一天。
    // 有实绩或已过日期的计划保持原样。节假日和重排在同一事务中保存。
    public static async Task<int> Reflow(AppDbContext db, string by)
    {
        var calendar = new ProductionCalendar(await db.Holidays.AsNoTracking().ToListAsync());
        var today = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date, DateTimeKind.Utc);
        var plans = await db.ProductionPlans.Include(p => p.Order)
            .Where(p => p.DeletedAt == null && p.PlanDate >= today
                && p.Order != null && p.Order.Status != "completed" && p.Order.Status != "archived").ToListAsync();
        var count = 0;
        foreach (var chain in plans.GroupBy(p => new { p.OrderId, p.PartName, p.StepNo, p.LineId }))
        {
            var protectedDates = chain.Where(PlanDateRules.HasActuals).Select(p => p.PlanDate.Date).ToHashSet();
            DateTime? previous = null;
            foreach (var day in chain.Where(p => !PlanDateRules.HasActuals(p)).GroupBy(p => p.PlanDate).OrderBy(g => g.Key))
            {
                var next = calendar.NextWorkday(previous.HasValue && day.Key <= previous.Value ? previous.Value.AddDays(1) : day.Key);
                // 原本同日的已录/待录行可以共存，但顺延不能把另一日的计划挤进已录实绩日。
                while (next != day.Key && protectedDates.Contains(next.Date)) next = calendar.NextWorkday(next.AddDays(1));
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
