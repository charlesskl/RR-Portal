using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Plans;

public record WorkbenchValues(string PlanDate, int LineId, double PlannedQty, int WorkerCount,
    double WorkHours, List<string> MachineNos, string Remark);
public record WorkbenchChange(int Id, string Token, WorkbenchValues Values);
public record WorkbenchRequest(List<WorkbenchChange>? Changes, bool Preview = true, string? Reason = null);
public record WorkbenchRow(int Id, string Token, string OrderNo, string ProductNo, string PartName,
    int StepNo, string Craft, long Demand, int? GoodQty, int? InboundQty, string? LockedReason, WorkbenchValues Values);

// 统一保存只接受计划字段，实绩、入库、库存及订单需求不在此接口的写入范围。
[ApiController]
[Route("api/plans/workbench")]
[Authorize(Roles = "clerk,manager,admin")]
public class PlanWorkbenchController(AppDbContext db) : ControllerBase
{
    static bool Day(string? text, out DateTime day) => DateTime.TryParseExact(text, "yyyy-MM-dd",
        CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out day);
    static WorkbenchValues Values(ProductionPlan p) => new(ScheduleCalc.Ymd(p.PlanDate), p.LineId,
        p.PlannedQty, p.WorkerCount, p.WorkHours, ScheduleCalc.SafeArr(p.MachineNos), p.Remark ?? "");
    // 包含实绩、软删和历史，兼容其他写接口及后台重排，不依赖所有旧接口都递增版本号。
    static string Token(ProductionPlan p) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new { p.Id, p.FactoryId, values = Values(p), p.StepNo, p.Craft,
            p.OrderId, p.PartName, p.SourcePartId, p.GroupNo, p.GoodQty, p.InboundQty, p.ReportedQty,
            p.DefectQty, p.Status, p.DeletedAt, p.LastModifiedAt, p.ModificationHistory,
            orderStatus = p.Order?.Status, orderUpdatedAt = p.Order?.UpdatedAt }))));
    static string? Locked(ProductionPlan p, HashSet<int> inbound) => inbound.Contains(p.Id) ? "已有入库申请"
        : PlanDateRules.HasActuals(p) ? "已录实绩" : !PlanDateRules.CanReschedule(p) ? "订单已完工或作废" : null;
    static string PartKey(ProductionPlan p) => $"{p.OrderId}|{p.PartName}";
    static long CommittedQty(ProductionPlan p) => PlanDateRules.HasActuals(p) ? p.GoodQty ?? p.ReportedQty ?? p.PlannedQty : p.PlannedQty;

    [HttpGet]
    public async Task<IActionResult> Get(string? from, string? to, int? orderId)
    {
        if (!Day(from, out var start) || !Day(to, out var end) || end < start || (end - start).TotalDays > 92)
            return BadRequest(new { error = "请选择有效日期范围，最多连续 93 天" });
        var query = db.ProductionPlans.AsNoTracking().Where(p => p.DeletedAt == null && p.PlanDate >= start && p.PlanDate <= end);
        if (orderId is > 0) query = query.Where(p => p.OrderId == orderId);
        var plans = await query.Include(p => p.Order!).ThenInclude(o => o.Product)
            .Include(p => p.Order!).ThenInclude(o => o.PartQtys)
            .OrderBy(p => p.PlanDate).ThenBy(p => p.LineId).ThenBy(p => p.Id).Take(5001).ToListAsync();
        if (plans.Count > 5000) return BadRequest(new { error = "计划超过 5000 行，请缩小日期范围" });
        var ids = plans.Select(p => p.Id).ToList();
        var inbound = (await db.InboundApplications.Where(a => ids.Contains(a.SourcePlanId)).Select(a => a.SourcePlanId).ToListAsync()).ToHashSet();
        var lines = await db.ProductionLines.AsNoTracking().OrderBy(l => l.Name).ToListAsync();
        var machines = await db.Machines.AsNoTracking().Where(m => m.IsActive).ToListAsync();
        return Ok(new {
            rows = plans.Select(p => new WorkbenchRow(p.Id, Token(p), p.Order?.ExternalOrderNo ?? "—",
                p.Order?.Product?.ProductNo ?? "待补产品", p.PartName, p.StepNo, p.Craft,
                p.Order?.PartQtys.Where(q => q.PartName == p.PartName).Sum(q => (long)q.Qty) ?? 0,
                p.GoodQty, p.InboundQty, Locked(p, inbound), Values(p))),
            lines = lines.Select(l => new { l.Id, l.Name, l.CraftType, l.IsActive, dailyLimit = l.DailyCapacityLimit,
                machineNos = machines.Where(m => m.LineId == l.Id).Select(m => m.MachineNo).OrderBy(n => n).ToList() })
        });
    }

    [HttpPost]
    public async Task<IActionResult> Save(WorkbenchRequest request)
    {
        var changes = request.Changes;
        if (changes is null || changes.Count == 0 || changes.Count > 1000 || changes.Any(c => c is null || c.Values is null)
            || changes.Select(c => c.Id).Distinct().Count() != changes.Count)
            return BadRequest(new { error = "每批请选择 1 至 1000 条不同的计划" });
        if ((request.Reason?.Length ?? 0) > 500) return BadRequest(new { error = "调整原因最多 500 字" });
        foreach (var change in changes)
        {
            var v = change.Values;
            if (!Day(v.PlanDate, out _) || !double.IsFinite(v.PlannedQty) || v.PlannedQty != Math.Truncate(v.PlannedQty)
                || v.PlannedQty <= 0 || v.PlannedQty > int.MaxValue || v.WorkerCount <= 0 || v.WorkerCount > 10000
                || !double.IsFinite(v.WorkHours) || v.WorkHours <= 0 || v.WorkHours > 24 || v.MachineNos is null
                || v.MachineNos.Any(n => string.IsNullOrWhiteSpace(n)) || v.MachineNos.Count != v.MachineNos.Distinct().Count())
                return BadRequest(new { error = $"计划 #{change.Id}：日期、正整数数量、人数、0～24 小时工时或机台格式不正确" });
            if ((v.Remark?.Length ?? 0) > 2000) return BadRequest(new { error = $"计划 #{change.Id}：备注最多 2000 字" });
            try { XmlConvert.VerifyXmlChars(v.Remark ?? ""); XmlConvert.VerifyXmlChars(request.Reason ?? ""); }
            catch (XmlException) { return BadRequest(new { error = "备注或原因包含无法导出 Excel 的控制字符" }); }
        }
        try { return await Apply(request); }
        catch (SqliteException ex) when (ex.SqliteErrorCode is 5 or 6) { return Stale(); }
        catch (DbUpdateException ex) when (ex.InnerException is SqliteException { SqliteErrorCode: 5 or 6 }) { return Stale(); }
    }

    ConflictObjectResult Stale() => Conflict(new { error = "计划已被修改或正在报工，本批未保存；请保留草稿并刷新核对" });
    async Task<IActionResult> Apply(WorkbenchRequest request)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var changes = request.Changes!;
        var ids = changes.Select(c => c.Id).ToHashSet();
        // 在同一事务读取全厂未撤销排期，校验跨日期、跨工序及未选中订单占用。
        var all = await db.ProductionPlans.Include(p => p.Order!).ThenInclude(o => o.PartQtys)
            .Where(p => p.DeletedAt == null).ToListAsync();
        var chosen = all.Where(p => ids.Contains(p.Id)).ToList();
        if (chosen.Count != ids.Count) return Stale();
        var inbound = (await db.InboundApplications.Where(a => ids.Contains(a.SourcePlanId)).Select(a => a.SourcePlanId).ToListAsync()).ToHashSet();
        if (chosen.Any(p => Locked(p, inbound) != null)) return BadRequest(new { error = "已录实绩、已有入库申请、完工或作废订单的计划不能修改；本批未保存" });
        var byId = changes.ToDictionary(c => c.Id);
        if (chosen.Any(p => Token(p) != byId[p.Id].Token)) return Stale();
        var lines = await db.ProductionLines.ToDictionaryAsync(l => l.Id);
        var machines = await db.Machines.Where(m => m.IsActive).ToListAsync();
        var calendar = new ProductionCalendar(await db.Holidays.AsNoTracking().ToListAsync());
        var warnings = new List<string>();
        var before = chosen.ToDictionary(p => p.Id, Values);
        var oldGroups = chosen.ToDictionary(p => p.Id, p => p.GroupNo);
        var oldQty = all.ToDictionary(p => p.Id, CommittedQty);
        var oldDates = all.ToDictionary(p => p.Id, p => p.PlanDate);
        foreach (var p in chosen)
        {
            var v = byId[p.Id].Values;
            Day(v.PlanDate, out var date);
            if (date != p.PlanDate && !calendar.IsWorkday(date)) return BadRequest(new { error = $"计划 #{p.Id}：{v.PlanDate} 是休息日" });
            if (!lines.TryGetValue(v.LineId, out var line) || !line.IsActive) return BadRequest(new { error = $"计划 #{p.Id}：目标拉别不存在或未启用" });
            if (!lines.TryGetValue(p.LineId, out var oldLine) || line.CraftType != oldLine.CraftType)
                return BadRequest(new { error = $"计划 #{p.Id}：只允许调整到相同工艺的拉别" });
            if (v.MachineNos.Any(no => !machines.Any(m => m.LineId == v.LineId && m.MachineNo == no)))
                return BadRequest(new { error = $"计划 #{p.Id}：机台不属于目标拉别或已停用" });
            var next = v with { Remark = v.Remark?.Trim() ?? "" };
            if (JsonSerializer.Serialize(before[p.Id]) == JsonSerializer.Serialize(next)) continue;
            if (p.GroupNo is not null && (p.PlanDate != date || p.LineId != v.LineId || p.WorkerCount != v.WorkerCount))
            {
                p.GroupNo = null;
                warnings.Add($"计划 #{p.Id} 日期、拉别或人数已变更，将解除原共享人数分组，按本行人数统计");
            }
            p.PlanDate = date; p.LineId = v.LineId; p.PlannedQty = (int)v.PlannedQty;
            p.WorkerCount = v.WorkerCount; p.WorkHours = v.WorkHours;
            p.MachineNos = JsonSerializer.Serialize(v.MachineNos); p.Remark = v.Remark?.Trim() ?? "";
        }
        var changed = chosen.Where(p => JsonSerializer.Serialize(before[p.Id]) != JsonSerializer.Serialize(Values(p))).ToList();
        if (changed.Count == 0) return Ok(new { adjustedPlans = 0, preview = request.Preview, warnings, changes = Array.Empty<object>() });
        var keys = changed.Select(PartKey).ToHashSet();
        var relevant = all.Where(p => keys.Contains(PartKey(p))).ToList();
        foreach (var part in relevant.GroupBy(PartKey))
        {
            var demand = part.First().Order!.PartQtys.Where(q => q.PartName == part.First().PartName).Sum(q => (long)q.Qty);
            foreach (var step in part.GroupBy(p => p.StepNo))
            {
                var total = step.Sum(CommittedQty); var previous = step.Sum(p => oldQty[p.Id]);
                if (total > demand && total > previous) return BadRequest(new { error = $"{part.First().Order!.ExternalOrderNo} / {part.First().PartName} 第{step.Key}道累计排期超过订单需求，请先减少其他日期计划" });
                if (total < demand) warnings.Add($"{part.First().Order!.ExternalOrderNo} / {part.First().PartName} 第{step.Key}道尚余 {demand - total:N0} 件未排");
            }
            // 前后工序按日累计校验，同一天可按工序顺序衔接。
            var steps = part.Select(p => p.StepNo).Distinct().Order().ToList();
            foreach (var step in steps.Where(n => n > 1))
            {
                var upstream = part.Where(p => p.StepNo == step - 1).ToList();
                if (upstream.Count == 0) { warnings.Add($"{part.First().Order!.ExternalOrderNo} / {part.First().PartName} 第{step}道缺少前道计划，请核对工序"); continue; }
                foreach (var day in part.Where(p => p.StepNo == step).Select(p => p.PlanDate).Distinct())
                {
                    var next = part.Where(p => p.StepNo == step && p.PlanDate <= day).Sum(CommittedQty) - upstream.Where(p => p.PlanDate <= day).Sum(CommittedQty);
                    var old = part.Where(p => p.StepNo == step && oldDates[p.Id] <= day).Sum(p => oldQty[p.Id]) - upstream.Where(p => oldDates[p.Id] <= day).Sum(p => oldQty[p.Id]);
                    if (next > 0 && next > old) return BadRequest(new { error = $"{part.First().PartName} 第{step}道在 {ScheduleCalc.Ymd(day)} 超过前道可供数量，请联动调整前后工序" });
                }
            }
            var finish = part.Max(p => p.PlanDate);
            if (part.First().Order!.DeliveryDate is { } due && finish > due)
                warnings.Add($"{part.First().Order!.ExternalOrderNo} / {part.First().PartName} 预计排至 {ScheduleCalc.Ymd(finish)}，晚于交货日 {ScheduleCalc.Ymd(due)}");
        }
        var materials = await db.OrderMaterials.ToListAsync();
        var productionChanged = changed.Where(p => JsonSerializer.Serialize(before[p.Id] with { Remark = "" }) != JsonSerializer.Serialize(Values(p) with { Remark = "" })).ToList();
        foreach (var material in materials.Where(m => keys.Contains($"{m.OrderId}|{m.PartName}")))
        {
            var part = relevant.Where(p => p.OrderId == material.OrderId && p.PartName == material.PartName).ToList();
            var first = part.Min(p => p.StepNo);
            foreach (var day in part.Where(p => p.StepNo == first).Select(p => p.PlanDate).Distinct())
            {
                var qty = part.Where(p => p.StepNo == first && p.PlanDate <= day).Sum(CommittedQty);
                var old = part.Where(p => p.StepNo == first && oldDates[p.Id] <= day).Sum(p => oldQty[p.Id]);
                var available = MaterialReflow.Available(material, long.MaxValue, day);
                if (qty > available && qty > old) return BadRequest(new { error = $"{material.PartName} 在 {ScheduleCalc.Ymd(day)} 累计排期超过已到料或有效预计到料数量，请先更新来料信息" });
            }
            if (material.AutoScheduleEnabled && productionChanged.Any(p => p.OrderId == material.OrderId && p.PartName == material.PartName))
                warnings.Add($"{material.PartName} 人工调整后将暂停该部位自动重排；再次保存来料可恢复");
        }
        var cells = changed.Select(p => (p.PlanDate, p.LineId)).Distinct().ToList();
        foreach (var (date, lineId) in cells)
        {
            var cell = all.Where(p => p.PlanDate == date && p.LineId == lineId).ToList();
            var total = cell.Sum(p => (long)p.PlannedQty); var line = lines[lineId];
            if (line.DailyCapacityLimit > 0 && total > line.DailyCapacityLimit)
                warnings.Add($"{ScheduleCalc.Ymd(date)} {line.Name} 排期 {total:N0} 件，超过日产能 {line.DailyCapacityLimit:N0} 件");
            var sharedMachines = cell.SelectMany(p => ScheduleCalc.SafeArr(p.MachineNos).Select(no => (p.Id, No: no)))
                .GroupBy(x => x.No).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            if (sharedMachines.Count > 0) warnings.Add($"{ScheduleCalc.Ymd(date)} {line.Name} 机台 {string.Join("、", sharedMachines)} 有多条计划，请核对分时安排");
        }
        var result = new { adjustedPlans = changed.Count, preview = request.Preview, warnings = warnings.Distinct().ToList(),
            changes = changed.Select(p => new { p.Id, before = before[p.Id], after = Values(p) }).ToList() };
        if (request.Preview) return Ok(result); // 事务释放时回滚，预览不触碰实绩、库存或来料状态。
        var now = DateTime.UtcNow; var by = User.FindFirst("username")?.Value ?? "unknown";
        foreach (var p in changed)
        {
            var history = JsonSerializer.Deserialize<List<JsonElement>>(p.ModificationHistory) ?? [];
            history.Add(JsonSerializer.SerializeToElement(new { action = "table_plan_edit", before = before[p.Id], after = Values(p), oldGroupNo = oldGroups[p.Id], newGroupNo = p.GroupNo, reason = request.Reason?.Trim(), by, at = now }));
            p.ModificationHistory = JsonSerializer.Serialize(history); p.LastModifiedAt = now; p.LastModifiedBy = by;
            p.Order!.UpdatedAt = now; p.Order.LastUpdatedBy = by;
        }
        await MaterialReflow.Pause(db, productionChanged, by, "manual_table_edit_pause");
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return Ok(result);
    }
}
