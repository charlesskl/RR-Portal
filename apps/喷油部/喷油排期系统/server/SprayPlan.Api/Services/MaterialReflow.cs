using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

public record MaterialTemplate(int StepNo, int LineId, string Craft, string ItemName, int? SourcePartId,
    string MachineNos, int WorkerCount, double WorkHours, string PlanType, long DailyTarget);
public record MaterialReflowResult(int RemovedPlans, int CreatedPlans, List<string> Warnings);

public static class MaterialReflow
{
    public static DateTime Today => DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date, DateTimeKind.Utc);

    // 首次生成也必须遵守已登记的来料。调用方先在同一事务保存本次计划，
    // 使 Apply 能读取工序配置；失败时计划、订单状态和来料快照一起回滚。
    public static async Task<MaterialReflowResult?> ApplyCreatedParts(AppDbContext db,
        IEnumerable<(int OrderId, string PartName)> createdParts, string by)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("来料重排必须在事务中执行");
        var keys = createdParts.ToHashSet();
        if (keys.Count == 0) return null;
        var orderIds = keys.Select(key => key.OrderId).ToList();
        var records = (await db.OrderMaterials.Where(material => material.AutoScheduleEnabled && orderIds.Contains(material.OrderId)).ToListAsync())
            .Where(material => keys.Contains((material.OrderId, material.PartName))).ToList();
        if (records.Count == 0) return null;
        var removed = 0; var created = 0; var warnings = new List<string>();
        foreach (var factory in records.GroupBy(material => material.FactoryId))
        {
            var result = await Apply(db, factory.Key, factory.Select(material => material.Id).ToHashSet(), by);
            removed += result.RemovedPlans; created += result.CreatedPlans; warnings.AddRange(result.Warnings);
        }
        return new(removed, created, warnings);
    }

    public static List<MaterialTemplate> Templates(OrderMaterial material) => JsonSerializer.Deserialize<List<MaterialTemplate>>(material.Configuration) ?? new();
    public static long Consumed(IEnumerable<ProductionPlan> source, int orderId, string partName)
    {
        var plans = source.Where(plan => plan.OrderId == orderId && plan.PartName == partName && plan.DeletedAt == null).ToList();
        return plans.Count == 0 ? 0 : plans.Where(plan => plan.StepNo == plans.Min(item => item.StepNo)).Sum(plan => (long)(plan.GoodQty ?? 0));
    }
    public static long Available(OrderMaterial material, long demand, DateTime day)
        => Math.Min(demand, material.ExpectedDate > Today && material.ExpectedDate.Value.Date <= day.Date ? demand : material.ArrivedQty);

    // 人工撤销排期具有优先权，不允许定时任务借用旧配置把它重新生成。
    public static async Task Pause(AppDbContext db, IEnumerable<ProductionPlan> cancelled, string by)
    {
        var keys = cancelled.Select(plan => (plan.OrderId, plan.PartName)).ToHashSet();
        var ids = keys.Select(key => key.OrderId).ToList();
        var records = await db.OrderMaterials.Where(material => ids.Contains(material.OrderId) && material.AutoScheduleEnabled).ToListAsync();
        foreach (var record in records.Where(material => keys.Contains((material.OrderId, material.PartName)))) {
            record.AutoScheduleEnabled = false; record.Version++; record.UpdatedAt = DateTime.UtcNow; record.UpdatedBy = by;
            var history = JsonSerializer.Deserialize<List<JsonElement>>(record.History) ?? new();
            history.Add(JsonSerializer.SerializeToElement(new { action = "manual_unschedule_pause", by, at = record.UpdatedAt }));
            record.History = JsonSerializer.Serialize(history);
        }
    }

    // 调用方必须持有事务。仅重排登记过来料的关联部位，未登记的旧单和所有实绩保持原样。
    public static async Task<MaterialReflowResult> Apply(AppDbContext db, string factoryId, HashSet<int> seedIds, string by)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("来料重排必须在事务中执行");
        var all = await db.OrderMaterials.Include(material => material.Order!).ThenInclude(order => order.PartQtys)
            .Where(material => material.FactoryId == factoryId && material.AutoScheduleEnabled && material.Order != null && material.Order.Status != "archived" && (material.Order.Status != "completed" || seedIds.Contains(material.Id))).ToListAsync();
        var plans = await db.ProductionPlans.Where(plan => plan.FactoryId == factoryId && plan.DeletedAt == null).ToListAsync();
        var configurations = new Dictionary<int, List<MaterialTemplate>>();
        foreach (var material in all)
        {
            var prior = Templates(material);
            var current = plans.Where(plan => plan.OrderId == material.OrderId && plan.PartName == material.PartName).GroupBy(plan => plan.StepNo)
                .Select(step => {
                    var template = step.OrderByDescending(plan => plan.PlanDate).ThenByDescending(plan => plan.Id).First();
                    var daily = step.Where(plan => plan.LineId == template.LineId && plan.MachineNos == template.MachineNos)
                        .GroupBy(plan => plan.PlanDate.Date).Max(day => day.Sum(plan => (long)plan.PlannedQty));
                    var old = prior.FirstOrDefault(item => item.StepNo == step.Key && item.LineId == template.LineId && item.MachineNos == template.MachineNos);
                    return new MaterialTemplate(step.Key, template.LineId, template.Craft, template.ItemName, template.SourcePartId,
                        template.MachineNos, template.WorkerCount, template.WorkHours, template.PlanType, Math.Max(daily, old?.DailyTarget ?? 0));
                }).ToList();
            // 待料导致全部计划移除后仍保留配置，用于后续登记到料重新生成。
            foreach (var old in prior.Where(old => current.All(item => item.StepNo != old.StepNo))) current.Add(old);
            // 不修改未参与重排的记录。
            configurations[material.Id] = current.OrderBy(item => item.StepNo).ToList();
        }
        var selected = all.Where(material => seedIds.Contains(material.Id)).ToList();
        var lineIds = selected.SelectMany(material => configurations[material.Id]).Select(item => item.LineId).ToHashSet();
        bool expanded;
        do {
            var neighbours = all.Where(material => selected.All(item => item.Id != material.Id) && configurations[material.Id].Any(item => lineIds.Contains(item.LineId))).ToList();
            expanded = neighbours.Count > 0;
            selected.AddRange(neighbours); lineIds.UnionWith(neighbours.SelectMany(material => configurations[material.Id]).Select(item => item.LineId));
        } while (expanded);
        foreach (var material in selected) material.Configuration = JsonSerializer.Serialize(configurations[material.Id]);
        var selectedKeys = selected.Select(material => (material.OrderId, material.PartName)).ToHashSet();
        var sourceIds = plans.Select(plan => plan.Id).ToList();
        var inboundIds = (await db.InboundApplications.Where(app => app.FactoryId == factoryId && sourceIds.Contains(app.SourcePlanId)).Select(app => app.SourcePlanId).ToListAsync()).ToHashSet();
        bool Protected(ProductionPlan plan) => PlanDateRules.HasActuals(plan) || inboundIds.Contains(plan.Id);
        var now = DateTime.UtcNow;
        var removed = 0; var created = 0; var warnings = new List<string>();
        foreach (var plan in plans.Where(plan => selectedKeys.Contains((plan.OrderId, plan.PartName)) && !Protected(plan)))
        {
            var history = JsonSerializer.Deserialize<List<JsonElement>>(plan.ModificationHistory) ?? new();
            history.Add(JsonSerializer.SerializeToElement(new { action = "material_reflow", oldDate = ScheduleCalc.Ymd(plan.PlanDate), oldQty = plan.PlannedQty, by, at = now }));
            plan.ModificationHistory = JsonSerializer.Serialize(history); plan.DeletedAt = now; plan.DeletedBy = by;
            plan.LastModifiedBy = by; plan.LastModifiedAt = now; removed++;
        }
        var lines = await db.ProductionLines.Where(line => line.FactoryId == factoryId && line.IsActive).ToDictionaryAsync(line => line.Id);
        var machines = await db.Machines.Where(machine => machine.FactoryId == factoryId && machine.IsActive).ToListAsync();
        var calendar = new ProductionCalendar(await db.Holidays.AsNoTracking().ToListAsync());
        // 先安排现已到料的部位，之后按急单、交期、订单稳定排序。不会移动未登记的订单来抢位。
        foreach (var material in selected.OrderByDescending(material => material.ArrivedQty > Consumed(plans, material.OrderId, material.PartName))
            .ThenByDescending(material => material.Order!.IsUrgent).ThenBy(material => material.Order!.DeliveryDate ?? DateTime.MaxValue)
            .ThenBy(material => material.OrderId).ThenBy(material => material.PartName, StringComparer.Ordinal))
        {
            var demand = material.Order!.PartQtys.Where(part => part.PartName == material.PartName).Sum(part => (long)part.Qty);
            var templates = Templates(material).OrderBy(item => item.StepNo).ToList();
            if (templates.Count == 0 && demand > 0) warnings.Add($"{material.Order.ExternalOrderNo} {material.PartName}：缺少首次工序配置，请先生成排期");
            int? previous = null;
            foreach (var template in templates)
            {
                var stepPlans = plans.Where(plan => plan.DeletedAt == null && plan.OrderId == material.OrderId && plan.PartName == material.PartName && plan.StepNo == template.StepNo).ToList();
                var committed = stepPlans.Sum(plan => (long)(plan.GoodQty ?? 0));
                var horizonAvailable = previous is null ? Available(material, demand, DateTime.MaxValue) : plans
                    .Where(plan => plan.DeletedAt == null && plan.OrderId == material.OrderId && plan.PartName == material.PartName && plan.StepNo == previous)
                    .Sum(plan => Protected(plan) ? (long)(plan.GoodQty ?? 0) : plan.PlannedQty);
                var remaining = Math.Max(0, Math.Min(demand, horizonAvailable) - committed);
                if (remaining == 0) { previous = template.StepNo; continue; }
                List<string> assigned;
                try { assigned = JsonSerializer.Deserialize<List<string>>(template.MachineNos) ?? new(); }
                catch (JsonException) { throw new InvalidOperationException($"{material.PartName} 原机台配置异常，本次登记未保存"); }
                if (!lines.TryGetValue(template.LineId, out var line) || template.DailyTarget <= 0
                    || assigned.Any(machine => !machines.Any(item => item.LineId == template.LineId && item.MachineNo == machine)))
                    throw new InvalidOperationException($"{material.Order.ExternalOrderNo} {material.PartName} 第{template.StepNo}道的原拉别、机台或日产量不可用，本次登记未保存，请先修正配置");
                var day = calendar.NextWorkday(Today); var scans = 0;
                while (remaining > 0 && scans++ < 600)
                {
                    var onDay = plans.Where(plan => plan.DeletedAt == null && plan.LineId == line.Id && plan.PlanDate.Date == day.Date).ToList();
                    var free = line.DailyCapacityLimit > 0 ? Math.Max(0, line.DailyCapacityLimit - onDay.Sum(plan => Math.Max((long)plan.PlannedQty, plan.GoodQty ?? 0))) : long.MaxValue;
                    if (assigned.Count > 0 && onDay.Any(plan => ScheduleCalc.SafeArr(plan.MachineNos).Intersect(assigned).Any())) free = 0;
                    var supplied = previous is null ? Available(material, demand, day) : plans
                        .Where(plan => plan.DeletedAt == null && plan.OrderId == material.OrderId && plan.PartName == material.PartName && plan.StepNo == previous && plan.PlanDate.Date < day.Date)
                        .Sum(plan => Protected(plan) ? (long)(plan.GoodQty ?? 0) : plan.PlannedQty);
                    var qty = (int)Math.Min(int.MaxValue, Math.Min(remaining, Math.Min(template.DailyTarget, Math.Min(free, Math.Max(0, supplied - committed)))));
                    if (qty > 0)
                    {
                        var plan = new ProductionPlan { OrderId = material.OrderId, FactoryId = factoryId, PartName = material.PartName,
                            SourcePartId = template.SourcePartId, ItemName = template.ItemName, StepNo = template.StepNo, Craft = template.Craft,
                            LineId = line.Id, MachineNos = template.MachineNos, WorkerCount = template.WorkerCount, WorkHours = template.WorkHours,
                            PlanType = template.PlanType, PlanDate = day, PlannedQty = qty, CreatedBy = by, CreatedAt = now, LastModifiedBy = by, LastModifiedAt = now,
                            ModificationHistory = JsonSerializer.Serialize(new[] { new { action = "material_schedule", materialId = material.Id, by, at = now } }) };
                        plans.Add(plan); db.ProductionPlans.Add(plan); remaining -= qty; committed += qty; created++;
                    }
                    day = calendar.NextWorkday(day.AddDays(1));
                }
                if (remaining > 0) throw new InvalidOperationException($"{material.PartName} 第{template.StepNo}道在 600 个工作日内无法安排，本次登记未保存");
                previous = template.StepNo;
            }
            material.LastReflowDate = Today; material.UpdatedBy = by; material.UpdatedAt = now; material.Version++;
            material.Order.LastUpdatedBy = by; material.Order.UpdatedAt = now;
        }
        foreach (var order in selected.Select(material => material.Order!).DistinctBy(order => order.Id))
            order.Status = OrderCalc.DemandStatus(order.Status, order.PartQtys, plans.Where(plan => plan.OrderId == order.Id));
        return new(removed, created, warnings);
    }
}
