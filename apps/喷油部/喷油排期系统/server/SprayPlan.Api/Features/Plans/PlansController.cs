using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Basic;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Plans;

// 排期计划 production_plans —— 对应现有 /api/plans + /api/plans/[id]。
// 读=登录、写=文员主管。PATCH 第6阶段只改计划字段；实绩分支(goodQty)留第7阶段。
[ApiController]
[Route("api/plans")]
[Authorize]
public class PlansController(AppDbContext db) : ControllerBase
{
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    static string PartNameKey(string? s) =>
        (s ?? "").Trim()
            .Replace('（', '(')
            .Replace('）', ')')
            .Replace(" ", "")
            .Replace("\t", "")
            .ToLowerInvariant();

    static int CraftPriority(string craft) => craft switch
    {
        "自动喷" => 0, "手喷" => 1, "移印" => 2, "UV" => 3, _ => 99,
    };

    static List<(int StepNo, string Craft)> StandardPasses(List<ProductPart> parts)
    {
        var crafts = parts
            .Select(p => (p.Craft ?? "").Trim())
            .Where(c => c.Length > 0)
            .Distinct()
            .OrderBy(CraftPriority)
            .ToList();
        if (crafts.Count == 0) return new() { (1, "") };
        var passes = parts.Select(p => p.CraftPasses).FirstOrDefault(v => v > 0);
        if (crafts.Count > 1) passes = Math.Max(passes, crafts.Count);
        if (passes <= 0) passes = 1;
        var result = new List<(int StepNo, string Craft)>();
        for (var i = 0; i < passes; i++) result.Add((i + 1, crafts[i % crafts.Count]));
        return result;
    }

    static PlanDto ToDto(ProductionPlan p, Dictionary<int, List<(int StepNo, string Craft)>> standards)
    {
        standards.TryGetValue(p.Id, out var standard);
        var standardCraft = standard?.FirstOrDefault(x => x.StepNo == p.StepNo).Craft;
        var standardStepCount = standard?.Count;
        var craftAdjusted = standard is not null &&
            (p.StepNo < 1 || p.StepNo > standard.Count || (standardCraft ?? "") != (p.Craft ?? "").Trim());
        return new(
        p.Id, p.PlanDate, p.PlanType, p.LineId, p.OrderId, p.ItemName, p.PartName, p.SourcePartId,
        ScheduleCalc.SafeArr(p.MachineNos), p.PlannedQty, p.WorkerCount, p.StepNo, p.Craft ?? "",
        standardStepCount, standardCraft, craftAdjusted,
        p.GoodQty, p.ReportedQty, p.DefectQty, p.WorkHours,
        p.ProductionValue, p.Status, p.Remark, p.CreatedBy, p.CreatedAt, p.LastModifiedBy, p.LastModifiedAt,
        p.ModificationHistory, p.DeletedAt, p.DeletedBy);
    }

    // GET /api/plans?planDate=&lineId=&orderId=&unrecordedBefore= —— 列计划（排除软删），planDate asc,id asc
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? planDate, [FromQuery] int? lineId,
        [FromQuery] int? orderId, [FromQuery] string? unrecordedBefore,
        [FromQuery] string? from, [FromQuery] string? to)
    {
        var q = db.ProductionPlans.Where(p => p.DeletedAt == null);
        if (!string.IsNullOrEmpty(planDate))
        {
            var d = DateUtil.ParseUtc(planDate);
            q = q.Where(p => p.PlanDate == d);
        }
        // 日期区间（周排按周取数用）：from ≤ planDate ≤ to
        if (!string.IsNullOrEmpty(from))
        {
            var d = DateUtil.ParseUtc(from);
            q = q.Where(p => p.PlanDate >= d);
        }
        if (!string.IsNullOrEmpty(to))
        {
            var d = DateUtil.ParseUtc(to);
            q = q.Where(p => p.PlanDate <= d);
        }
        if (lineId is not null) q = q.Where(p => p.LineId == lineId);
        if (orderId is not null) q = q.Where(p => p.OrderId == orderId);
        // 历史欠录：planDate < 指定日 且未录（goodQty 为空）
        if (!string.IsNullOrEmpty(unrecordedBefore))
        {
            var d = DateUtil.ParseUtc(unrecordedBefore);
            q = q.Where(p => p.PlanDate < d && p.GoodQty == null);
        }
        var plans = await q.OrderBy(p => p.PlanDate).ThenBy(p => p.Id).ToListAsync();
        var standards = await BuildStandardPasses(plans);
        return Ok(plans.Select(p => ToDto(p, standards)));
    }

    async Task<Dictionary<int, List<(int StepNo, string Craft)>>> BuildStandardPasses(List<ProductionPlan> plans)
    {
        var result = new Dictionary<int, List<(int StepNo, string Craft)>>();
        var sourcePartIds = plans
            .Where(p => p.SourcePartId is not null)
            .Select(p => p.SourcePartId!.Value)
            .Distinct()
            .ToList();
        if (sourcePartIds.Count == 0) return result;

        var anchors = await db.ProductParts
            .Where(p => sourcePartIds.Contains(p.Id))
            .ToListAsync();
        var itemIds = anchors.Select(p => p.ItemId).Distinct().ToList();
        var itemParts = await db.ProductParts
            .Where(p => itemIds.Contains(p.ItemId))
            .ToListAsync();
        var anchorById = anchors.ToDictionary(p => p.Id);

        foreach (var plan in plans)
        {
            if (plan.SourcePartId is null || !anchorById.TryGetValue(plan.SourcePartId.Value, out var anchor)) continue;
            var key = PartNameKey(anchor.PartName);
            var group = itemParts
                .Where(p => p.ItemId == anchor.ItemId && PartNameKey(p.PartName) == key)
                .OrderBy(p => p.PartOrder)
                .ThenBy(p => p.Id)
                .ToList();
            if (group.Count == 0) group.Add(anchor);
            result[plan.Id] = StandardPasses(group);
        }
        return result;
    }

    // POST /api/plans —— 批量建计划行；建后把涉及订单从 received 推进到 scheduled
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreatePlansRequest req)
    {
        var plans = req.Plans;
        if (plans is null || plans.Count == 0)
            return BadRequest(new { error = "无计划行" });

        foreach (var p in plans)
        {
            if (string.IsNullOrEmpty(p.PlanDate) || p.LineId is null or 0 || p.OrderId is null or 0
                || string.IsNullOrWhiteSpace(p.ItemName) || string.IsNullOrWhiteSpace(p.PartName))
                return BadRequest(new { error = "计划行字段不完整" });
            if (p.PlannedQty is null || p.PlannedQty <= 0)
                return BadRequest(new { error = "计划生产数必须大于 0" });
            if (p.StepNo is not null && p.StepNo <= 0)
                return BadRequest(new { error = "工序道次必须大于 0" });
            if (!string.IsNullOrWhiteSpace(p.Craft) && !CraftTypes.IsValid(p.Craft.Trim()))
                return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        }

        var by = CurrentUser();
        var rows = plans.Select(p => new ProductionPlan
        {
            PlanDate = DateUtil.ParseUtc(p.PlanDate!),
            PlanType = p.PlanType == "weekly" ? "weekly" : "daily",
            LineId = p.LineId!.Value,
            OrderId = p.OrderId!.Value,
            ItemName = p.ItemName!,
            PartName = p.PartName!,
            SourcePartId = p.SourcePartId,
            MachineNos = JsonSerializer.Serialize(p.MachineNos ?? new()),
            PlannedQty = (int)p.PlannedQty!.Value,
            WorkerCount = p.WorkerCount is > 0 ? p.WorkerCount.Value : 1,
            StepNo = p.StepNo is > 0 ? p.StepNo.Value : 1,
            Craft = (p.Craft ?? "").Trim(),
            CreatedBy = by,
            CreatedAt = DateTime.UtcNow,
            LastModifiedAt = DateTime.UtcNow,
        }).ToList();
        db.ProductionPlans.AddRange(rows);

        // 把状态仍为 received 的涉及订单推进到 scheduled（一次 SaveChanges 原子提交）
        var orderIds = plans.Select(p => p.OrderId!.Value).Distinct().ToList();
        var toUpdate = await db.Orders.Where(o => orderIds.Contains(o.Id) && o.Status == "received").ToListAsync();
        foreach (var o in toUpdate) { o.Status = "scheduled"; o.LastUpdatedBy = by; }

        await db.SaveChangesAsync();
        return StatusCode(201, new CreatePlansResult(plans.Count));
    }

    // PATCH /api/plans/{id} —— 改计划字段 或 录实绩（goodQty→算产值+status recorded+改值留痕）
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdatePlanRequest req)
    {
        // 值校验前置（非法立即 400，不依赖记录是否存在，对齐旧逻辑）
        if (req.PlannedQty is not null && req.PlannedQty <= 0)
            return BadRequest(new { error = "计划生产数必须大于 0" });
        if (req.WorkerCount is not null && req.WorkerCount <= 0)
            return BadRequest(new { error = "人数必须大于 0" });
        if (req.StepNo is not null && req.StepNo <= 0)
            return BadRequest(new { error = "工序道次必须大于 0" });
        if (req.Craft is not null && req.Craft.Trim().Length > 0 && !CraftTypes.IsValid(req.Craft.Trim()))
            return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        if (req.GoodQty is not null && req.GoodQty < 0)
            return BadRequest(new { error = "实际生产数必须 ≥ 0" });

        var p = await db.ProductionPlans.FindAsync(id);
        if (p is null) return NotFound(new { error = "计划不存在" });

        // ── 计划字段 ──
        if (req.PlannedQty is not null) p.PlannedQty = (int)req.PlannedQty.Value;
        if (req.MachineNos is not null) p.MachineNos = JsonSerializer.Serialize(req.MachineNos);
        if (req.WorkerCount is not null) p.WorkerCount = req.WorkerCount.Value > 0 ? req.WorkerCount.Value : 1;
        if (req.PlanDate is not null) p.PlanDate = DateUtil.ParseUtc(req.PlanDate);
        if (req.LineId is not null && req.LineId.Value > 0) p.LineId = req.LineId.Value; // 周排换拉
        if (req.StepNo is not null) p.StepNo = req.StepNo.Value;
        if (req.Craft is not null) p.Craft = req.Craft.Trim();
        if (req.Remark is not null) p.Remark = req.Remark;

        // ── 实绩分支 ──
        if (req.GoodQty is not null)
        {
            // 取部位价（核+人工+油漆，已无特殊色加价）
            var part = p.SourcePartId is not null ? await db.ProductParts.FindAsync(p.SourcePartId.Value) : null;
            var unitPrice = part is not null
                ? RecordingCalc.PartUnitPrice(part.UnitCost, part.LaborPrice, part.PaintCost, 0)
                : 0;

            // 改已录行(原本已有 goodQty 且值变了) → 追加留痕
            if (p.GoodQty is not null && p.GoodQty != req.GoodQty.Value)
            {
                var hist = ParseHistory(p.ModificationHistory);
                hist.Add(new { from = p.GoodQty.Value, to = req.GoodQty.Value, by = CurrentUser(), at = DateTime.UtcNow.ToString("o"), reason = "改实绩" });
                p.ModificationHistory = JsonSerializer.Serialize(hist);
            }
            p.GoodQty = req.GoodQty.Value;
            p.ProductionValue = RecordingCalc.ProductionValue(req.GoodQty.Value, unitPrice);
            p.Status = "recorded";
            if (req.ReportedQty is not null) p.ReportedQty = req.ReportedQty.Value >= 0 ? req.ReportedQty.Value : 0;
            if (req.WorkHours is not null) p.WorkHours = req.WorkHours.Value > 0 ? req.WorkHours.Value : 11;

            // ── 订单状态自动流转（录实绩触发，状态只读、不许人工改，靠这里推进）──
            await AutoAdvanceOrderStatus(p.OrderId);
        }

        p.LastModifiedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(new PlanUpdated(p.Id, p.GoodQty, p.ProductionValue, p.Status, p.PlannedQty, ScheduleCalc.SafeArr(p.MachineNos)));
    }

    // 解析改值留痕 JSON 为列表（失败返回空），追加后再序列化
    static List<object> ParseHistory(string s)
    {
        try { var arr = JsonSerializer.Deserialize<List<JsonElement>>(s); return arr is null ? new() : arr.Cast<object>().ToList(); }
        catch { return new(); }
    }

    // 订单状态自动流转（录实绩后调用，不 SaveChanges，由调用方统一提交）：
    //  - 有任意已录实绩(recorded) → 至少「在产」
    //  - 该订单全部未删计划行都已 recorded（且至少有一行）→ 「完工」
    // 完工/作废不回退；received/scheduled 才向前推进。
    private async Task AutoAdvanceOrderStatus(int orderId)
    {
        // 订单含明细行+部位需求（按真实采购数量逐部位判完工，木桶逻辑）
        var order = await db.Orders
            .Include(o => o.Lines).ThenInclude(l => l.PartQtys)
            .FirstOrDefaultAsync(o => o.Id == orderId);
        if (order is null || order.Status is "completed" or "archived") return;

        // 查实体（非投影），EF identity map 会合并内存中刚改为 recorded、尚未 SaveChanges 的当前行，
        // 避免投影 SQL 读到旧值导致刚录的实绩不被计入。
        var plans = await db.ProductionPlans
            .Where(p => p.OrderId == orderId && p.DeletedAt == null)
            .ToListAsync();

        bool anyRecorded = plans.Any(p => p.Status == "recorded");

        // 各(子件,部位)累计已录入库 = Σ goodQty（按部位名聚合）
        var recByPart = plans
            .GroupBy(p => (p.ItemName, p.PartName))
            .ToDictionary(g => g.Key, g => g.Sum(p => p.GoodQty ?? 0));

        // 订单真实需求：每个明细行下每个部位的采购数量。完工=每个有需求的部位累计入库 ≥ 需求。
        var parts = order.Lines
            .SelectMany(l => l.PartQtys.Select(q => (
                Demand: q.Qty,
                Recorded: recByPart.TryGetValue((l.ItemName, q.PartName), out var r) ? r : 0)))
            .ToList();

        if (RecordingCalc.IsOrderComplete(parts)) order.Status = "completed";
        else if (anyRecorded) order.Status = "in_production";

        order.LastUpdatedBy = CurrentUser();
        order.UpdatedAt = DateTime.UtcNow;
    }

    // DELETE /api/plans/{id} —— 软删（deletedAt + deletedBy）
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.ProductionPlans.FindAsync(id);
        if (p is null) return NotFound(new { error = "计划不存在" });
        p.DeletedAt = DateTime.UtcNow;
        p.DeletedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(new PlanDeleted(p.Id, p.DeletedAt));
    }
}
