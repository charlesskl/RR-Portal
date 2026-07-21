using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Schedule;

// 甘特图数据聚合 —— 对应现有 /api/schedule + lib/scheduleData.ts buildGanttData。
// 返回所有非作废订单，每个含 上车间日/预计出单日(口径A木桶)/是否已排/计划明细/部位需求量。
[ApiController]
[Route("api/schedule")]
[Authorize]
public class ScheduleController(AppDbContext db) : ControllerBase
{
    // GET /api/schedule?today=YYYY-MM-DD
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? today)
    {
        var todayDate = string.IsNullOrEmpty(today) ? DateTime.UtcNow : DateUtil.ParseUtc(today);

        // 拉所有非作废订单 + 产品子件/部位 + 明细行数量 + 未软删计划
        var orders = await db.Orders
            .Where(o => o.Status != "archived")
            .OrderByDescending(o => o.Id)
            .Include(o => o.Product!).ThenInclude(p => p.Items).ThenInclude(i => i.Parts)
            .Include(o => o.Lines).ThenInclude(l => l.PartQtys)
            .Include(o => o.Plans.Where(p => p.DeletedAt == null))
            .ToListAsync();

        var result = orders.Select(o =>
        {
            var activePlans = o.Plans;   // Include 已过滤软删
            var scheduled = activePlans.Count > 0;
            var firstPlanDate = ScheduleCalc.OrderFirstPlanDate(activePlans.Select(p => ScheduleCalc.Ymd(p.PlanDate)));

            // 展开可排部位清单（含总需求、产能属性）
            var parts = ScheduleCalc.ExpandOrderParts(o);

            // 每部位投入资源：优先取对应计划行的资源配置；无计划时机喷用 stdMachineCount、人工喷 1 人
            var load = parts.Select(pt =>
            {
                var planForPart = activePlans.FirstOrDefault(p => p.SourcePartId == pt.SourcePartId);
                int resourceCount = pt.ProductionMode == "manual"
                    ? (planForPart?.WorkerCount ?? 1)
                    : (planForPart != null ? ScheduleCalc.SafeLen(planForPart.MachineNos) : pt.StdMachineCount);
                return (pt.TotalDemand, resourceCount, pt.DailyCapacity);
            });

            var remDays = ScheduleCalc.OrderRemainingDays(load);
            var expectedOutDate = remDays is null ? null : ScheduleCalc.Ymd(ScheduleCalc.AddDays(todayDate, remDays.Value));

            return new GanttOrder(
                o.Id, o.ExternalOrderNo, o.Product?.ProductNo ?? "待补产品", o.Status,
                o.DeliveryDate is null ? null : ScheduleCalc.Ymd(o.DeliveryDate.Value),
                scheduled, firstPlanDate, expectedOutDate,
                activePlans.Select(p => new GanttPlan(
                    ScheduleCalc.Ymd(p.PlanDate), p.ItemName, p.PartName, p.SourcePartId,
                    p.PlannedQty, p.GoodQty, p.ReportedQty, ScheduleCalc.SafeArr(p.MachineNos), p.WorkerCount)).ToList(),
                parts.Select(pt => new DemandPart(pt.SourceItemId, pt.ItemName, pt.SourcePartId, pt.PartName, pt.TotalDemand)).ToList());
        }).ToList();

        return Ok(result);
    }

    // GET /api/schedule/orders —— 排期录入页用：可排订单（received/scheduled/in_production）
    // + 展开部位清单（含 productionMode/dailyCapacity/stdMachineCount/totalDemand）。
    // 复用 ScheduleCalc.ExpandOrderParts，与前端 lib/schedule.ts expandOrderParts 同口径。
    [HttpGet("orders")]
    public async Task<IActionResult> SchedulableOrders()
    {
        var statuses = new[] { "received", "scheduled", "in_production" };
        var orders = await db.Orders
            .Where(o => statuses.Contains(o.Status))
            .OrderByDescending(o => o.Id)
            .Include(o => o.Product!).ThenInclude(p => p.Items).ThenInclude(i => i.Parts)
            .Include(o => o.Lines).ThenInclude(l => l.PartQtys)
            .Include(o => o.Plans.Where(p => p.DeletedAt == null))
            .ToListAsync();

        var result = orders.Select(o => new SchedulableOrder(
            o.Id, o.ExternalOrderNo, o.Product?.ProductNo ?? "待补产品", o.IsMA, o.IsUrgent, o.Plans.Count > 0,
            ScheduleCalc.ExpandOrderParts(o))).ToList();

        return Ok(result);
    }

    // GET /api/schedule/overview?from=YYYY-MM-DD&to=YYYY-MM-DD —— 排期总览看板（拉别×日期·只读）。
    // 返回：活跃拉别清单 + 区间内未软删的计划明细行（含 stepNo/craft/货号/机台/人数）。
    // 网格聚合、产能占用%、红黄绿由前端算（口径纯 UI，无 DB 依赖）。读操作=登录即可（viewer 也能看）。
    [HttpGet("overview")]
    public async Task<IActionResult> Overview([FromQuery] string? from, [FromQuery] string? to)
    {
        if (string.IsNullOrWhiteSpace(from) || string.IsNullOrWhiteSpace(to))
            return BadRequest(new { error = "from 和 to 必填" });
        var fromD = DateUtil.ParseUtc(from);
        var toD = DateUtil.ParseUtc(to);
        if (toD < fromD) return BadRequest(new { error = "to 不能早于 from" });

        // 拉别当列：只列启用拉，按拉名升序（A/B/C/UV），前端表头据此排列
        var lines = await db.ProductionLines.Where(l => l.IsActive)
            .OrderBy(l => l.Name)
            .Select(l => new OverviewLine(l.Id, l.Name, l.CraftType, l.DailyCapacityLimit))
            .ToListAsync();

        // 区间内每条未软删计划行（带货号，供点开明细）；按日期→拉别排序，前端好分格
        var plans = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && p.PlanDate >= fromD && p.PlanDate <= toD)
            .Include(p => p.Order).ThenInclude(o => o!.Product)
            .OrderBy(p => p.PlanDate).ThenBy(p => p.LineId).ThenBy(p => p.StepNo)
            .ToListAsync();

        var planDtos = plans.Select(p => new OverviewPlan(
            p.Id, p.LineId, ScheduleCalc.Ymd(p.PlanDate), p.OrderId,
            p.Order?.Product?.ProductNo ?? "待补产品",
            p.ItemName, p.PartName, p.StepNo, p.Craft, p.PlannedQty,
            ScheduleCalc.SafeArr(p.MachineNos), p.WorkerCount)).ToList();

        return Ok(new OverviewResult(lines, planDtos));
    }

    // 取当前登录用户（与 PlansController 对齐，用 username claim）
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    // 月排纳入的订单状态：已接单/已排/在产（未完工未作废）
    private static readonly string[] AutoStatuses = { "received", "scheduled", "in_production" };

    private static string MonthlyPartNameKey(string? s) =>
        (s ?? "").Trim()
            .Replace('（', '(')
            .Replace('）', ')')
            .Replace(" ", "")
            .Replace("\t", "")
            .ToLowerInvariant();

    private static List<MonthlyScheduleCalc.PartInput> BuildMonthlyParts(Order o)
    {
        var result = new List<MonthlyScheduleCalc.PartInput>();
        if (o.Product is null) return result;

        foreach (var line in o.Lines)
        {
            var item = o.Product.Items.FirstOrDefault(i => i.Id == line.SourceItemId);
            if (item is null) continue;

            var qtyGroups = line.PartQtys
                .Select(pq =>
                {
                    var anchor = pq.SourcePartId is int sid
                        ? item.Parts.FirstOrDefault(p => p.Id == sid)
                        : null;
                    var partName = (anchor?.PartName ?? pq.PartName ?? "").Trim();
                    return new { Qty = pq, Anchor = anchor, PartName = partName, Key = MonthlyPartNameKey(partName) };
                })
                .Where(x => x.Key.Length > 0)
                .GroupBy(x => x.Key);

            foreach (var qtyGroup in qtyGroups)
            {
                var first = qtyGroup
                    .OrderBy(x => x.Qty.PartOrder)
                    .ThenBy(x => x.Qty.Id)
                    .First();
                var partName = first.PartName;

                var group = item.Parts
                    .Where(p => MonthlyPartNameKey(p.PartName) == qtyGroup.Key)
                    .OrderBy(p => p.PartOrder)
                    .ThenBy(p => p.Id)
                    .ToList();
                if (group.Count == 0 && first.Anchor is not null) group.Add(first.Anchor);
                if (group.Count == 0) continue;

                var sourcePartIds = qtyGroup
                    .Where(x => x.Qty.SourcePartId is not null)
                    .Select(x => x.Qty.SourcePartId!.Value)
                    .ToHashSet();
                var anchor = group.FirstOrDefault(p => sourcePartIds.Contains(p.Id)) ?? first.Anchor;
                var representative = anchor is not null && group.Any(p => p.Id == anchor.Id) ? anchor : group[0];
                var craftSet = group
                    .Select(p => (p.Craft ?? "").Trim())
                    .Where(c => c.Length > 0)
                    .Distinct()
                    .ToList();
                if (craftSet.Count == 0 && !string.IsNullOrWhiteSpace(representative.Craft))
                    craftSet.Add(representative.Craft.Trim());

                var passes = group.Select(p => p.CraftPasses).FirstOrDefault(v => v > 0);
                if (craftSet.Count > 1) passes = Math.Max(passes, craftSet.Count);
                var totalDemand = qtyGroup.Max(x => x.Qty.Qty);

                result.Add(new MonthlyScheduleCalc.PartInput(
                    representative.Id, item.ItemName, partName, totalDemand,
                    representative.DailyCapacity, representative.StdMachineCount, representative.Craft, representative.IsTumbler,
                    passes, craftSet));
            }
        }

        return result;
    }

    private static string MonthlyPlanKey(int orderId, int lineId, DateTime planDate, int? sourcePartId, int stepNo, string? craft) =>
        string.Join("|", orderId, lineId, ScheduleCalc.Ymd(planDate), sourcePartId ?? 0, stepNo, (craft ?? "").Trim());

    // POST /api/schedule/auto —— 月排「生成预览」：读库 → 倒排算法 → 返回草稿 + 提示清单，不落库。
    [HttpPost("auto")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> AutoGenerate([FromBody] AutoScheduleRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Month) || string.IsNullOrWhiteSpace(req.Today))
            return BadRequest(new { error = "month 和 today 必填" });
        var mode = req.Mode == "rebuild" ? "rebuild" : "incremental";

        // 纳入口径：生产周期与所选自然月有交集。
        // 即：下单日早于下个月月初，且交期为空或交期不早于本月月初。
        // 这样 5 月下单、7 月交货的未完工订单，在 5/6/7 月排期中都会被纳入。
        var monthStart = DateUtil.ParseUtc(req.Month + "-01");
        var monthEnd = monthStart.AddMonths(1);

        var orders = await db.Orders
            .Where(o => AutoStatuses.Contains(o.Status) &&
                o.OrderDate < monthEnd &&
                (o.DeliveryDate == null || o.DeliveryDate >= monthStart))
            .Include(o => o.Product!).ThenInclude(p => p.Items).ThenInclude(i => i.Parts)
            .Include(o => o.Lines).ThenInclude(l => l.PartQtys)
            .ToListAsync();

        var skipped = new List<AutoHint>();
        var noCapacity = new List<AutoHint>();
        var input = new List<MonthlyScheduleCalc.OrderInput>();
        foreach (var o in orders)
        {
            // 增量模式：只跳过当前月份已有计划的订单；其他月份的计划不影响跨月订单继续排本月。
            bool hasPlansInMonth = await db.ProductionPlans.AnyAsync(p =>
                p.OrderId == o.Id && p.DeletedAt == null &&
                p.PlanDate >= monthStart && p.PlanDate < monthEnd);
            if (mode == "incremental" && hasPlansInMonth) { skipped.Add(new AutoHint(o.Id, o.ExternalOrderNo, "existing_skipped")); continue; }
            var parts = BuildMonthlyParts(o);
            // Never silently create a partial order schedule. If any required child part
            // has no usable capacity, show a clear warning and leave the whole order for correction.
            if (parts.Any(p => p.TotalDemand > 0 && ScheduleCalc.PartDailyOutput(p.StdMachineCount, p.DailyCapacity) <= 0))
            {
                noCapacity.Add(new AutoHint(o.Id, o.ExternalOrderNo, "zero_capacity"));
                continue;
            }
            input.Add(new MonthlyScheduleCalc.OrderInput(o.Id, o.DeliveryDate is null ? "" : ScheduleCalc.Ymd(o.DeliveryDate.Value), o.IsMA, parts));
        }

        // 节假日 → 日历：type=holiday 进休息日、type=workday 进上班日（覆盖周末）
        var holidays = await db.Holidays.ToListAsync();
        var cal = new MonthlyScheduleCalc.Calendar(
            holidays.Where(h => h.Type == "holiday").Select(h => ScheduleCalc.Ymd(h.Date)).ToHashSet(),
            holidays.Where(h => h.Type == "workday").Select(h => ScheduleCalc.Ymd(h.Date)).ToHashSet());

        // 按拉别传入（每拉自有日上限 DailyCapacityLimit），算法逐天正排卡产能
        var lineInputs = await db.ProductionLines.Where(l => l.IsActive)
            .Select(l => new MonthlyScheduleCalc.LineInput(l.Id, l.Name, l.CraftType, l.DailyCapacityLimit))
            .ToListAsync();
        var calc = MonthlyScheduleCalc.Generate(input, lineInputs, req.Today!, 2, cal);

        var byId = orders.ToDictionary(o => o.Id);
        DraftRow ToDraft(MonthlyScheduleCalc.PlanRow r)
        {
            var o = byId[r.OrderId];
            return new DraftRow(r.OrderId, o.ExternalOrderNo, o.Product?.ProductNo ?? "待补产品", r.SourcePartId, r.ItemName, r.PartName, r.PlanDate, r.PlannedQty,
                ScheduleCalc.Ymd(o.OrderDate), o.DeliveryDate is null ? null : ScheduleCalc.Ymd(o.DeliveryDate.Value), r.LineId, r.LineName,
                r.StepNo, r.Craft);
        }
        AutoHint Hint(int id, string reason) => new(id, byId.TryGetValue(id, out var o) ? o.ExternalOrderNo : "", reason);

        var result = new AutoScheduleResult(req.Month!, mode,
            calc.Rows.Select(ToDraft).ToList(),
            calc.Overdue.Select(id => Hint(id, "overdue")).ToList(),
            calc.OverloadedDays,
            calc.NoDeliveryDate.Select(id => Hint(id, "no_delivery")).ToList(),
            calc.MaSkipped.Select(id => Hint(id, "ma_skipped")).ToList(),
            skipped,
            calc.NoLine.Select(id => Hint(id, "no_line")).ToList(),
            noCapacity);
        return Ok(result);
    }

    // POST /api/schedule/auto/commit —— 月排「保存/重排」：把草稿写入 production_plans。
    // rebuild 模式先软删本月未录实绩(status=planned)计划行；草稿含真实拉别(由算法分配)，按行写 LineId。
    [HttpPost("auto/commit")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> AutoCommit([FromBody] CommitAutoRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Month) || req.Draft is null || req.Draft.Count == 0)
            return BadRequest(new { error = "month / draft 必填" });
        var by = CurrentUser();
        // 兜底：防异常草稿（无拉别草稿应在生成阶段已过滤到 NoLineOrders，此处二次校验）
        if (req.Draft.Any(d => d.LineId <= 0))
            return BadRequest(new { error = "草稿缺拉别，请重新生成" });

        var draftRows = req.Draft
            .Select(d => new { Row = d, PlanDate = DateUtil.ParseUtc(d.PlanDate) })
            .ToList();
        if (draftRows.Any(x =>
            x.Row.OrderId <= 0 ||
            x.Row.LineId <= 0 ||
            x.Row.SourcePartId <= 0 ||
            x.Row.PlannedQty <= 0 ||
            x.Row.StepNo <= 0 ||
            string.IsNullOrWhiteSpace(x.Row.ItemName) ||
            string.IsNullOrWhiteSpace(x.Row.PartName) ||
            string.IsNullOrWhiteSpace(x.Row.Craft)))
            return BadRequest(new { error = "草稿计划行不完整，请重新生成后再保存" });

        var duplicateDraft = draftRows
            .GroupBy(x => MonthlyPlanKey(x.Row.OrderId, x.Row.LineId, x.PlanDate, x.Row.SourcePartId, x.Row.StepNo, x.Row.Craft))
            .FirstOrDefault(g => g.Count() > 1);
        if (duplicateDraft is not null)
            return BadRequest(new { error = "草稿中存在重复计划行，请重新生成后再保存" });

        var monthStart = DateUtil.ParseUtc(req.Month + "-01");
        var monthEnd = monthStart.AddMonths(1);
        int cleared = 0;
        var clearedPlanIds = new HashSet<int>();
        if (req.Mode == "rebuild")
        {
            // 软删本月未录实绩计划行（不碰 recorded），并把因此清空计划的订单退回 received
            var old = await db.ProductionPlans
                .Where(p => p.DeletedAt == null && p.Status == "planned" && p.PlanDate >= monthStart && p.PlanDate < monthEnd)
                .ToListAsync();
            foreach (var p in old) { p.DeletedAt = DateTime.UtcNow; p.DeletedBy = by; }
            cleared = old.Count;
            clearedPlanIds = old.Select(p => p.Id).ToHashSet();
            var affected = old.Select(p => p.OrderId).Distinct().ToList();
            foreach (var oid in affected)
            {
                bool stillHas = await db.ProductionPlans.AnyAsync(p => p.OrderId == oid && p.DeletedAt == null && !clearedPlanIds.Contains(p.Id));
                if (!stillHas) { var o = await db.Orders.FindAsync(oid); if (o != null && o.Status == "scheduled") o.Status = "received"; }
            }
        }

        var draftOrderIds = draftRows.Select(x => x.Row.OrderId).Distinct().ToList();
        var draftDates = draftRows.Select(x => x.PlanDate).Distinct().ToList();
        var existingPlans = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && !clearedPlanIds.Contains(p.Id) && draftOrderIds.Contains(p.OrderId) && draftDates.Contains(p.PlanDate))
            .Select(p => new { p.OrderId, p.LineId, p.PlanDate, p.SourcePartId, p.StepNo, p.Craft })
            .ToListAsync();
        var existingKeys = existingPlans
            .Select(p => MonthlyPlanKey(p.OrderId, p.LineId, p.PlanDate, p.SourcePartId, p.StepNo, p.Craft))
            .ToHashSet();
        if (draftRows.Any(x => existingKeys.Contains(MonthlyPlanKey(x.Row.OrderId, x.Row.LineId, x.PlanDate, x.Row.SourcePartId, x.Row.StepNo, x.Row.Craft))))
            return BadRequest(new { error = "该月份已存在相同计划行，请先清空本月重排或刷新后再保存" });

        foreach (var x in draftRows)
        {
            var d = x.Row;
            db.ProductionPlans.Add(new ProductionPlan
            {
                PlanDate = x.PlanDate, PlanType = "daily", LineId = d.LineId,
                OrderId = d.OrderId, ItemName = d.ItemName, PartName = d.PartName, SourcePartId = d.SourcePartId,
                StepNo = d.StepNo, Craft = d.Craft,   // 工序链：第几道 + 该道工序大类
                MachineNos = "[]", PlannedQty = d.PlannedQty, WorkerCount = 1, Status = "planned",
                CreatedBy = by, CreatedAt = DateTime.UtcNow, LastModifiedAt = DateTime.UtcNow, ModificationHistory = "[]",
            });
        }
        // 涉及订单 received → scheduled（一次原子提交）
        var orderIds = draftOrderIds;
        var toUp = await db.Orders.Where(o => orderIds.Contains(o.Id) && o.Status == "received").ToListAsync();
        foreach (var o in toUp) { o.Status = "scheduled"; o.LastUpdatedBy = by; }

        await db.SaveChangesAsync();
        return Ok(new CommitAutoResult(req.Draft.Count, cleared));
    }

    // POST /api/schedule/orders/{orderId}/unschedule —— 按订单整体撤销排期。
    // 软删该订单全部未删计划行，订单状态退回 received（不删订单）。
    // 已录实绩(recorded)的订单禁止撤销，避免丢实绩数据。
    [HttpPost("orders/{orderId:int}/unschedule")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Unschedule(int orderId)
    {
        var order = await db.Orders.FindAsync(orderId);
        if (order is null) return NotFound(new { error = "订单不存在" });

        var plans = await db.ProductionPlans
            .Where(p => p.OrderId == orderId && p.DeletedAt == null)
            .ToListAsync();

        // 有已录实绩的计划行 → 拒绝
        if (plans.Any(p => p.Status == "recorded"))
            return BadRequest(new { error = "该订单已有实绩，不能撤销排期；请先处理实绩" });

        var by = CurrentUser();
        var now = DateTime.UtcNow;
        foreach (var p in plans) { p.DeletedAt = now; p.DeletedBy = by; }

        // 订单退回已接单（仅当当前是已排期/在产；完工/作废不动）
        if (order.Status is "scheduled" or "in_production")
        {
            order.Status = "received";
            order.LastUpdatedBy = by;
            order.UpdatedAt = now;
        }

        await db.SaveChangesAsync();
        return Ok(new { orderId, deletedPlans = plans.Count, status = order.Status });
    }
}
