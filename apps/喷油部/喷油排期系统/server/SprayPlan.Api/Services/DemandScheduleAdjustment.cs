using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

public record DemandScheduleResult(long AddedQty, long ReducedQty, int CreatedPlans, List<string> Warnings);

// 仅调整所选部位的未报工计划。调用方负责事务，失败时数量与计划一起回滚。
public static class DemandScheduleAdjustment
{
    public static async Task<DemandScheduleResult> Apply(AppDbContext db, Order order, List<OrderPartQty> parts,
        HashSet<string> selectedParts, string by)
    {
        var plans = await db.ProductionPlans.Where(plan => plan.OrderId == order.Id && plan.DeletedAt == null).ToListAsync();
        // 配置快照不参与减排修改。整道工序曾因需求归零而自动减排时，允许沿用其配置，
        // 但不恢复已删除的原记录，也不采用人工撤销或已有实绩/入库关联的历史计划。
        var original = await db.ProductionPlans.AsNoTracking().Where(plan => plan.OrderId == order.Id).ToListAsync();
        var planIds = original.Select(plan => plan.Id).ToList();
        var inboundSources = (await db.InboundApplications.Where(app => planIds.Contains(app.SourcePlanId))
            .Select(app => app.SourcePlanId).ToListAsync()).ToHashSet();
        bool Protected(ProductionPlan plan) => PlanDateRules.HasActuals(plan) || inboundSources.Contains(plan.Id);
        var now = DateTime.UtcNow;
        var today = DateTime.SpecifyKind(now.AddHours(8).Date, DateTimeKind.Utc);
        var calendar = new ProductionCalendar(await db.Holidays.AsNoTracking().ToListAsync());
        var lines = await db.ProductionLines.AsNoTracking().ToDictionaryAsync(line => line.Id);
        var machines = await db.Machines.AsNoTracking().Where(machine => machine.IsActive).ToListAsync();
        var occupancy = await db.ProductionPlans.AsNoTracking()
            .Where(plan => plan.OrderId != order.Id && plan.DeletedAt == null && plan.PlanDate >= today).ToListAsync();
        occupancy.AddRange(plans);
        var warnings = new List<string>();
        long added = 0, reduced = 0;
        int created = 0;

        void Audit(ProductionPlan plan, string action, int before, int after)
        {
            List<JsonElement> history;
            try { history = JsonSerializer.Deserialize<List<JsonElement>>(plan.ModificationHistory) ?? new(); }
            catch (JsonException) { history = new() { JsonSerializer.SerializeToElement(new { legacyHistory = plan.ModificationHistory }) }; }
            history.Add(JsonSerializer.SerializeToElement(new { action, oldValue = before, newValue = after,
                reason = "订单需求调整自动补排/减排", by, at = now }));
            plan.ModificationHistory = JsonSerializer.Serialize(history);
            plan.LastModifiedBy = by; plan.LastModifiedAt = now;
        }

        foreach (var part in parts.Where(part => selectedParts.Contains(part.PartName)).GroupBy(part => part.PartName))
        {
            var demand = part.Sum(part => (long)part.Qty);
            var configuration = original.Where(plan => plan.PartName == part.Key).GroupBy(plan => plan.StepNo).SelectMany(step => {
                var active = step.Where(plan => plan.DeletedAt is null).ToList();
                if (active.Count > 0) return active;
                // 人工撤销晚于自动减排时不能借用更早的配置；同毫秒混合撤销也保守跳过。
                var latestDeletion = step.Max(plan => plan.DeletedAt);
                var latest = step.Where(plan => plan.DeletedAt == latestDeletion).ToList();
                return latest.All(plan => IsAutomaticReductionTemplate(plan, inboundSources)) ? latest : new List<ProductionPlan>();
            });
            var steps = configuration.GroupBy(plan => plan.StepNo).OrderBy(step => step.Key).ToList();
            if (steps.Count == 0)
            {
                if (demand > 0) warnings.Add($"{part.Key}：尚未配置工序和拉别，请先生成首次排期");
                continue;
            }
            // 先减排所有工序，再按工序顺序补排，后工序只使用前一天已可用的上道产量。
            foreach (var step in steps)
            {
                var active = plans.Where(plan => plan.DeletedAt == null && plan.PartName == part.Key && plan.StepNo == step.Key).ToList();
                var actual = active.Sum(plan => (long)(plan.GoodQty ?? 0));
                var pending = active.Where(plan => !Protected(plan)).OrderByDescending(plan => plan.PlanDate).ThenByDescending(plan => plan.Id).ToList();
                var excess = Math.Max(0, actual + pending.Sum(plan => (long)plan.PlannedQty) - demand);
                foreach (var plan in pending)
                {
                    if (excess == 0) break;
                    var take = (int)Math.Min(excess, plan.PlannedQty);
                    var before = plan.PlannedQty;
                    if (take == before) { plan.DeletedAt = now; plan.DeletedBy = by; }
                    else plan.PlannedQty -= take;
                    Audit(plan, "demand_reduce", before, before - take);
                    reduced += take; excess -= take;
                }
            }
            int? previousStep = null;
            foreach (var step in steps)
            {
                var live = plans.Where(plan => plan.DeletedAt == null && plan.PartName == part.Key && plan.StepNo == step.Key).ToList();
                var committed = live.Sum(plan => Protected(plan) ? (long)(plan.GoodQty ?? 0) : plan.PlannedQty);
                var missing = Math.Max(0, demand - committed);
                if (missing == 0) { previousStep = step.Key; continue; }
                var template = step.OrderByDescending(plan => plan.PlanDate).ThenByDescending(plan => plan.Id).First();
                if (!lines.TryGetValue(template.LineId, out var line) || !line.IsActive)
                {
                    warnings.Add($"{part.Key} 第{step.Key}道：原拉别已停用或不可用，尚需补排 {missing:N0} 件");
                    previousStep = step.Key; continue;
                }
                List<string> assignedMachines;
                try { assignedMachines = JsonSerializer.Deserialize<List<string>>(template.MachineNos) ?? new(); }
                catch (JsonException) { assignedMachines = new() { "无效机台配置" }; }
                if (assignedMachines.Any(machine => !machines.Any(item => item.LineId == line.Id && item.MachineNo == machine)))
                {
                    warnings.Add($"{part.Key} 第{step.Key}道：原机台配置不可用，尚需补排 {missing:N0} 件");
                    previousStep = step.Key; continue;
                }
                // 沿用相同资源组合的原单日最大计划量，不放大日产能。
                var dailyTarget = step.Where(plan => plan.LineId == line.Id && plan.MachineNos == template.MachineNos)
                    .GroupBy(plan => plan.PlanDate.Date).Select(day => day.Sum(plan => (long)plan.PlannedQty)).Max();
                if (dailyTarget <= 0)
                {
                    warnings.Add($"{part.Key} 第{step.Key}道：缺少有效原日产量，尚需补排 {missing:N0} 件");
                    previousStep = step.Key; continue;
                }
                var day = calendar.NextWorkday(new[] { today, step.Max(plan => plan.PlanDate.Date).AddDays(1) }.Max());
                var scans = 0;
                while (missing > 0 && scans++ < 600)
                {
                    var onDay = occupancy.Where(plan => plan.DeletedAt == null && plan.LineId == line.Id && plan.PlanDate.Date == day.Date).ToList();
                    var lineLoad = onDay.Sum(plan => Math.Max((long)plan.PlannedQty, plan.GoodQty ?? 0));
                    var free = line.DailyCapacityLimit > 0 ? Math.Max(0, line.DailyCapacityLimit - lineLoad) : long.MaxValue;
                    if (assignedMachines.Count > 0 && onDay.Any(plan => ScheduleCalc.SafeArr(plan.MachineNos).Intersect(assignedMachines).Any())) free = 0;
                    var upstream = previousStep is null ? long.MaxValue : plans
                        .Where(plan => plan.DeletedAt == null && plan.PartName == part.Key && plan.StepNo == previousStep.Value && plan.PlanDate.Date < day.Date)
                        .Sum(plan => Protected(plan) ? (long)(plan.GoodQty ?? 0) : plan.PlannedQty);
                    var available = previousStep is null ? long.MaxValue : Math.Max(0, upstream - committed);
                    var qty = (int)Math.Min(int.MaxValue, Math.Min(missing, Math.Min(dailyTarget, Math.Min(free, available))));
                    if (qty > 0)
                    {
                        var plan = new ProductionPlan {
                            OrderId = order.Id, FactoryId = order.FactoryId, PartName = part.Key,
                            ItemName = template.ItemName, SourcePartId = template.SourcePartId,
                            StepNo = step.Key, Craft = template.Craft, LineId = line.Id, PlanDate = day,
                            PlanType = template.PlanType, MachineNos = template.MachineNos,
                            WorkerCount = template.WorkerCount, WorkHours = template.WorkHours,
                            PlannedQty = qty, Status = "planned", CreatedBy = by, CreatedAt = now,
                            LastModifiedBy = by, LastModifiedAt = now
                        };
                        Audit(plan, "demand_supplement", 0, qty);
                        db.ProductionPlans.Add(plan); plans.Add(plan); occupancy.Add(plan);
                        created++; added += qty; missing -= qty; committed += qty;
                    }
                    day = calendar.NextWorkday(day.AddDays(1));
                }
                if (missing > 0)
                    throw new InvalidOperationException($"{part.Key} 第{step.Key}道：未来 600 个工作日内产能或上道工序供给不足，无法自动补齐；本次修改未保存，请先调整排期资源");
                previousStep = step.Key;
            }
        }
        if (added > 0 || reduced > 0)
            order.Status = OrderCalc.DemandStatus(order.Status, parts, plans);
        return new(added, reduced, created, warnings);
    }

    private static bool IsAutomaticReductionTemplate(ProductionPlan plan, ISet<int> inboundSources)
    {
        if (plan.DeletedAt is null || PlanDateRules.HasActuals(plan) || inboundSources.Contains(plan.Id)
            || plan.PlannedQty <= 0 || string.IsNullOrWhiteSpace(plan.DeletedBy)
            || plan.LastModifiedBy != plan.DeletedBy || plan.LastModifiedAt != plan.DeletedAt.Value
            || string.IsNullOrWhiteSpace(plan.ModificationHistory)) return false;
        try
        {
            using var history = JsonDocument.Parse(plan.ModificationHistory);
            if (history.RootElement.ValueKind != JsonValueKind.Array || history.RootElement.GetArrayLength() == 0) return false;
            var last = history.RootElement[history.RootElement.GetArrayLength() - 1];
            return last.ValueKind == JsonValueKind.Object
                && last.TryGetProperty("action", out var action) && action.ValueKind == JsonValueKind.String && action.GetString() == "demand_reduce"
                && last.TryGetProperty("oldValue", out var before) && before.ValueKind == JsonValueKind.Number && before.TryGetInt32(out var oldQty) && oldQty == plan.PlannedQty
                && last.TryGetProperty("newValue", out var after) && after.ValueKind == JsonValueKind.Number && after.TryGetInt32(out var newQty) && newQty == 0
                && last.TryGetProperty("by", out var actor) && actor.ValueKind == JsonValueKind.String && actor.GetString() == plan.DeletedBy
                && last.TryGetProperty("at", out var timestamp) && timestamp.ValueKind == JsonValueKind.String && timestamp.TryGetDateTimeOffset(out var at)
                // SQLite 的原有时间转换器只保存毫秒；审计 JSON 保留完整时间精度。
                && at.ToUnixTimeMilliseconds() == new DateTimeOffset(plan.DeletedAt.Value).ToUnixTimeMilliseconds();
        }
        catch (JsonException) { return false; }
    }
}
