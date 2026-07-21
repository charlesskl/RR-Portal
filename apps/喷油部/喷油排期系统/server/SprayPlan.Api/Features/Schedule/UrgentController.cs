using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Schedule;

// ───────── 急单 preview/commit DTO ─────────
// 文员手填的急单排期行（部位 × 日期 × 拉 × 数量 × 人数 × 机台）
public record UrgentRow(int LineId, string PlanDate, int PlannedQty, int? SourcePartId, string? ItemName, string? PartName, int WorkerCount, string? MachineNos);
public record UrgentPreviewRequest(int UrgentOrderId, List<UrgentRow> Rows);

public record OverloadDay(int LineId, string LineName, string Date, int Already, int Incoming, int Limit);
public record UrgentCandidateDto(int OrderId, string ExternalOrderNo, int LineId, string LineName, string? DeliveryDate, string CurrentFinish, int Slack, bool FitToStop, string Reason);
public record UrgentPreviewResult(int Need, bool CanDirect, List<OverloadDay> Overloads, List<UrgentCandidateDto> Candidates, int CandidateSlackTotal, bool CandidateEnough, string? Hint);

public record UrgentCommitRequest(int UrgentOrderId, List<UrgentRow> Rows, List<int> PausedOrderIds);
public record PostponedOrder(int OrderId, string ExternalOrderNo, int Days, string NewFinish);
public record UrgentCommitResult(int CreatedRows, List<PostponedOrder> Postponed);

// 急单：preview（只算不落库：产能检测+暂停候选）/ commit（落库：写急单计划行+被停单整单顺延）。
// 顺延用「日期往后挪 X 个可排日（跳节假日/周末）」，不依赖未完成的月排引擎。
[ApiController]
[Route("api/schedule/urgent")]
[Authorize]
public class UrgentController(AppDbContext db) : ControllerBase
{
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    // GET /api/schedule/urgent/orders — 待排急单列表（isUrgent，带部位展开 + 交货日 + 是否已排）
    [HttpGet("orders")]
    public async Task<IActionResult> UrgentOrders()
    {
        var statuses = new[] { "received", "scheduled", "in_production" };
        var orders = await db.Orders
            .Where(o => o.IsUrgent && statuses.Contains(o.Status))
            .OrderByDescending(o => o.Id)
            .Include(o => o.Product!).ThenInclude(p => p.Items).ThenInclude(i => i.Parts)
            .Include(o => o.Lines).ThenInclude(l => l.PartQtys)
            .Include(o => o.Plans.Where(p => p.DeletedAt == null))
            .ToListAsync();

        var result = orders.Select(o => new
        {
            id = o.Id,
            externalOrderNo = o.ExternalOrderNo,
            productNo = o.Product?.ProductNo ?? "待补产品",
            deliveryDate = o.DeliveryDate == null ? null : ScheduleCalc.Ymd(o.DeliveryDate.Value),
            scheduled = o.Plans.Count > 0,
            parts = ScheduleCalc.ExpandOrderParts(o),
        }).ToList();
        return Ok(result);
    }

    // POST /api/schedule/urgent/preview — 只算不落库
    [HttpPost("preview")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Preview([FromBody] UrgentPreviewRequest req)
    {
        if (req.Rows is null || req.Rows.Count == 0)
            return BadRequest(new { error = "急单排期行为空" });

        var rows = req.Rows.Select(r => new { r.LineId, Date = DateUtil.ParseUtc(r.PlanDate).Date, r.PlannedQty }).ToList();

        // 急单要占的天数 = 拟排行里不同日期数
        var occupiedDays = rows.Select(r => r.Date).Distinct().ToList();
        int need = occupiedDays.Count;

        // 涉及拉别信息
        var urgentLineIds = rows.Select(r => r.LineId).Distinct().ToList();
        var urgentLines = await db.ProductionLines.Where(l => urgentLineIds.Contains(l.Id))
            .Select(l => new { l.Id, l.Name, l.Workshop, l.CraftType, l.DailyCapacityLimit }).ToListAsync();
        var lineMap = urgentLines.ToDictionary(l => l.Id);

        var dayFrom = occupiedDays.Min();
        var dayTo = occupiedDays.Max();

        // 查急单拉别这几天的已排（产能检测用）
        var existing = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && urgentLineIds.Contains(p.LineId) && p.PlanDate >= dayFrom && p.PlanDate <= dayTo)
            .Select(p => new { p.LineId, p.PlanDate, p.PlannedQty }).ToListAsync();
        var alreadyByCell = existing.Where(p => occupiedDays.Contains(p.PlanDate.Date))
            .GroupBy(p => (p.LineId, p.PlanDate.Date))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.PlannedQty));

        // 拟占合计 by (拉,天)
        var incomingByCell = rows.GroupBy(r => (r.LineId, r.Date))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.PlannedQty));

        // 产能检测
        var overloads = new List<OverloadDay>();
        foreach (var kv in incomingByCell)
        {
            var (lineId, day) = kv.Key;
            int incoming = kv.Value;
            int already = alreadyByCell.GetValueOrDefault((lineId, day), 0);
            int limit = lineMap.TryGetValue(lineId, out var lc) ? lc.DailyCapacityLimit : 0;
            if (UrgentCalc.IsOverloaded(already, incoming, limit))
                overloads.Add(new OverloadDay(lineId, lineMap[lineId].Name, day.ToString("yyyy-MM-dd"), already, incoming, limit));
        }

        if (overloads.Count == 0)
            return Ok(new UrgentPreviewResult(need, true, overloads, new List<UrgentCandidateDto>(), 0, true, null));

        // 候选拉别 = 同车间 + 同工艺（按急单拉别的 workshop+craft 组合）
        var wsCrafts = urgentLines.Select(l => (l.Workshop, l.CraftType)).Distinct().ToList();
        var allLines = await db.ProductionLines.Where(l => l.IsActive)
            .Select(l => new { l.Id, l.Name, l.Workshop, l.CraftType }).ToListAsync();
        var candLineIds = allLines
            .Where(l => wsCrafts.Any(wc => wc.Workshop == l.Workshop && wc.CraftType == l.CraftType))
            .Select(l => l.Id).ToList();
        var candLineName = allLines.ToDictionary(l => l.Id, l => l.Name);

        // 候选计划行：候选拉、被占那几天、未录实绩、非急单自己
        var candPlansRaw = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && candLineIds.Contains(p.LineId)
                        && p.PlanDate >= dayFrom && p.PlanDate <= dayTo
                        && p.Status != "recorded" && p.OrderId != req.UrgentOrderId)
            .Select(p => new { p.OrderId, p.LineId, p.PlanDate }).ToListAsync();
        var candPlans = candPlansRaw.Where(p => occupiedDays.Contains(p.PlanDate.Date)).ToList();

        var candOrderIds = candPlans.Select(p => p.OrderId).Distinct().ToList();
        if (candOrderIds.Count == 0)
            return Ok(new UrgentPreviewResult(
                need, false, overloads, new List<UrgentCandidateDto>(), 0, false,
                "冲突日期内没有可暂停的未录实绩计划，请返回调整日期、拉别或数量。"));

        // 候选订单交货日
        var candOrders = await db.Orders.Where(o => candOrderIds.Contains(o.Id))
            .Select(o => new { o.Id, o.ExternalOrderNo, o.DeliveryDate }).ToListAsync();
        // 各候选订单「当前预计完成日」= 它所有未删计划行的最晚 planDate
        var finishByOrder = (await db.ProductionPlans
            .Where(p => p.DeletedAt == null && candOrderIds.Contains(p.OrderId))
            .Select(p => new { p.OrderId, p.PlanDate }).ToListAsync())
            .GroupBy(p => p.OrderId)
            .ToDictionary(g => g.Key, g => g.Max(x => x.PlanDate));

        var candidates = new List<UrgentCandidateDto>();
        foreach (var o in candOrders)
        {
            if (!finishByOrder.TryGetValue(o.Id, out var finish)) continue;
            int lineId = candPlans.First(p => p.OrderId == o.Id).LineId;
            int slack = o.DeliveryDate.HasValue ? UrgentCalc.Slack(o.DeliveryDate.Value, finish) : 0;
            bool fitToStop = o.DeliveryDate.HasValue && slack >= need;
            string reason = !o.DeliveryDate.HasValue
                ? "缺少交货日，无法判断是否可顺延"
                : fitToStop
                    ? $"可顺延 {need} 天，仍不超过交货日"
                    : $"最多只能缓 {slack} 天，本次需顺延 {need} 天";
            candidates.Add(new UrgentCandidateDto(
                o.Id, o.ExternalOrderNo, lineId, candLineName.GetValueOrDefault(lineId, ""),
                o.DeliveryDate?.ToString("yyyy-MM-dd"), finish.ToString("yyyy-MM-dd"),
                slack, fitToStop, reason));
        }
        candidates = candidates.OrderByDescending(c => c.Slack).ToList();
        int candidateSlackTotal = candidates.Where(c => c.FitToStop).Sum(c => c.Slack);
        bool candidateEnough = candidateSlackTotal >= need;
        string? hint = candidateEnough
            ? null
            : candidates.Count == 0
                ? "没有可暂停候选，请返回调整日期、拉别或数量。"
                : "可安全顺延的候选不足，请减少急单占用、改到空余日期，或人工确认其他处理方式。";

        return Ok(new UrgentPreviewResult(need, false, overloads, candidates, candidateSlackTotal, candidateEnough, hint));
    }

    // POST /api/schedule/urgent/commit — 落库：写急单计划行 + 被停单整单顺延
    [HttpPost("commit")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Commit([FromBody] UrgentCommitRequest req)
    {
        if (req.Rows is null || req.Rows.Count == 0)
            return BadRequest(new { error = "急单排期行为空" });

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        var parsedRows = req.Rows.Select(r => new { r, Date = DateUtil.ParseUtc(r.PlanDate).Date }).ToList();

        // 急单要占的天数（顺延量 X）
        int days = parsedRows.Select(x => x.Date).Distinct().Count();
        var pausedIds = (req.PausedOrderIds ?? new()).Distinct().ToList();

        if (pausedIds.Count > 0 && days > 0)
        {
            var selectedFinishes = (await db.ProductionPlans
                .Where(p => p.DeletedAt == null && pausedIds.Contains(p.OrderId) && p.Status != "recorded")
                .Select(p => new { p.OrderId, p.PlanDate })
                .ToListAsync())
                .GroupBy(p => p.OrderId)
                .ToDictionary(g => g.Key, g => g.Max(x => x.PlanDate));

            var selectedOrders = await db.Orders.Where(o => pausedIds.Contains(o.Id))
                .Select(o => new { o.Id, o.ExternalOrderNo, o.DeliveryDate })
                .ToListAsync();

            var unsafeOrders = selectedOrders
                .Where(o => !o.DeliveryDate.HasValue
                            || !selectedFinishes.TryGetValue(o.Id, out var finish)
                            || UrgentCalc.Slack(o.DeliveryDate.Value, finish) < days)
                .Select(o => o.ExternalOrderNo)
                .ToList();

            if (unsafeOrders.Count > 0)
                return BadRequest(new { error = $"所选停单顺延 {days} 天后会超期或缺少交货日：{string.Join("、", unsafeOrders)}" });
        }

        // 节假日集合（覆盖一个足够宽的窗口：被停单计划最晚日 + X + 缓冲）
        var holidayRows = await db.Holidays.ToListAsync();
        var rest = holidayRows.Where(h => h.Type == "holiday").Select(h => h.Date.Date).ToHashSet();
        var workOverride = holidayRows.Where(h => h.Type == "workday").Select(h => h.Date.Date).ToHashSet();

        using var tx = await db.Database.BeginTransactionAsync();

        // 1) 写急单计划行
        foreach (var x in parsedRows)
        {
            db.ProductionPlans.Add(new ProductionPlan
            {
                PlanDate = x.Date,
                PlanType = "daily",
                LineId = x.r.LineId,
                OrderId = req.UrgentOrderId,
                ItemName = x.r.ItemName ?? "",
                PartName = x.r.PartName ?? "",
                SourcePartId = x.r.SourcePartId,
                MachineNos = x.r.MachineNos ?? "[]",
                PlannedQty = x.r.PlannedQty,
                WorkerCount = x.r.WorkerCount <= 0 ? 1 : x.r.WorkerCount,
                Status = "planned",
                CreatedBy = user,
                CreatedAt = now,
                LastModifiedAt = now,
            });
        }

        // 2) 被停单整单顺延 X 个可排日
        var postponed = new List<PostponedOrder>();
        if (pausedIds.Count > 0 && days > 0)
        {
            var pausedOrders = await db.Orders.Where(o => pausedIds.Contains(o.Id))
                .Select(o => new { o.Id, o.ExternalOrderNo }).ToListAsync();
            var pausedOrderName = pausedOrders.ToDictionary(o => o.Id, o => o.ExternalOrderNo);

            // 被停单的所有未删、未录实绩的计划行（已录实绩锁定不动）
            var plans = await db.ProductionPlans
                .Where(p => p.DeletedAt == null && pausedIds.Contains(p.OrderId) && p.Status != "recorded")
                .ToListAsync();

            // 构造足够宽的「不可排日」集合（覆盖所有被停计划日往后 X + 60 天）
            ISet<DateTime> blocked = BuildBlocked(plans.Select(p => p.PlanDate.Date), days, rest, workOverride);

            foreach (var g in plans.GroupBy(p => p.OrderId))
            {
                DateTime newFinish = DateTime.MinValue;
                foreach (var p in g)
                {
                    var moved = UrgentCalc.Postpone(p.PlanDate.Date, days, blocked);
                    p.PlanDate = moved;
                    p.LastModifiedBy = user;
                    p.LastModifiedAt = now;
                    p.ModificationHistory = AppendHistory(p.ModificationHistory, req.UrgentOrderId, days, user, now);
                    if (moved > newFinish) newFinish = moved;
                }
                postponed.Add(new PostponedOrder(g.Key, pausedOrderName.GetValueOrDefault(g.Key, ""), days, newFinish.ToString("yyyy-MM-dd")));
            }
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Ok(new UrgentCommitResult(parsedRows.Count, postponed));
    }

    // 构造 [minDate, maxDate + days + 60] 范围内的不可排日集合：周末 ∪ 节假日休 − 调休补班
    static ISet<DateTime> BuildBlocked(IEnumerable<DateTime> seedDates, int days, ISet<DateTime> rest, ISet<DateTime> workOverride)
    {
        var list = seedDates.ToList();
        var from = (list.Count > 0 ? list.Min() : DateTime.UtcNow.Date);
        var to = (list.Count > 0 ? list.Max() : DateTime.UtcNow.Date).AddDays(days + 60);
        var blocked = new HashSet<DateTime>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            bool weekend = d.DayOfWeek == DayOfWeek.Saturday || d.DayOfWeek == DayOfWeek.Sunday;
            bool isRest = (weekend || rest.Contains(d)) && !workOverride.Contains(d);
            if (isRest) blocked.Add(d);
        }
        return blocked;
    }

    // 往 modificationHistory(JSON 数组串) 追加一条「因急单顺延」留痕
    static string AppendHistory(string current, int urgentOrderId, int days, string by, DateTime at)
    {
        JsonArray arr;
        try { arr = JsonNode.Parse(string.IsNullOrWhiteSpace(current) ? "[]" : current) as JsonArray ?? new JsonArray(); }
        catch { arr = new JsonArray(); }
        arr.Add(new JsonObject
        {
            ["type"] = "urgent_postpone",
            ["urgentOrderId"] = urgentOrderId,
            ["days"] = days,
            ["by"] = by,
            ["at"] = at.ToString("o"),
        });
        return arr.ToJsonString();
    }
}
