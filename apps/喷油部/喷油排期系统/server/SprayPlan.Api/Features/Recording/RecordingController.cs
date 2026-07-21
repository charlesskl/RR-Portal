using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Recording;

// 导出弹窗手填的按拉别文字备注（按 lineId 匹配，避免显示名/原始名不一致丢备注）
public record LineNote(int LineId, string? HeaderText, string? MiscText);
// 导出请求：date 必填；mode = plan(计划版,默认) | actual(实际版,含生产数)；lineNotes 按拉别手填
public record ExportRequest(string? Date, string? Mode, List<LineNote>? LineNotes);

// 实绩导出 —— 对应现有 /api/recording/export。任意登录可读。
[ApiController]
[Route("api/recording")]
[Authorize]
public class RecordingController(AppDbContext db) : ControllerBase
{
    // POST /api/recording/export { date, mode, lineNotes } → 当天每拉一张《每日生产明细表》xlsx 下载
    [HttpPost("export")]
    public async Task<IActionResult> Export([FromBody] ExportRequest req)
    {
        if (string.IsNullOrEmpty(req.Date)) return BadRequest(new { error = "缺 date" });
        var date = req.Date;
        var mode = req.Mode == "actual" ? "actual" : "plan";
        var day = DateUtil.ParseUtc(date);

        var plans = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && p.PlanDate == day)
            .OrderBy(p => p.LineId).ThenBy(p => p.Id)
            .Include(p => p.Line)
            .Include(p => p.Order!).ThenInclude(o => o.Product)
            .Include(p => p.Order!).ThenInclude(o => o.Lines).ThenInclude(l => l.PartQtys)
            .ToListAsync();

        // 余下数 = 总需求 − 该订单该部位全期累计 goodQty
        var orderIds = plans.Select(p => p.OrderId).Distinct().ToList();
        var allRec = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && orderIds.Contains(p.OrderId))
            .Select(p => new { p.OrderId, p.PartName, p.GoodQty })
            .ToListAsync();
        var recMap = new Dictionary<string, int>();
        foreach (var r in allRec)
        {
            var k = $"{r.OrderId}|{r.PartName}";
            recMap[k] = (recMap.TryGetValue(k, out var v) ? v : 0) + (r.GoodQty ?? 0);
        }

        var rows = plans.Select(p =>
        {
            var demand = PartDemandByName(p.Order!.Lines, p.ItemName, p.PartName);
            var recorded = recMap.TryGetValue($"{p.OrderId}|{p.PartName}", out var rec) ? rec : 0;
            return new RecordingExport.ExportRow(
                p.LineId, p.Line!.Name, p.Line.LeaderName, p.Line.CraftType,
                date, ScheduleCalc.SafeArr(p.MachineNos),
                p.Order.Product!.ProductNo, $"{p.ItemName}{p.PartName}",
                demand, p.WorkerCount, p.WorkHours, p.PlannedQty,
                RecordingCalc.PartRemainingQty(demand, recorded),
                recorded,                       // producedQty：实际版显示的累计入库数
                p.Remark ?? "");
        }).ToList();

        // 按拉别 id 归字典；同 id 只取首条（防前端误传重复抛 500）
        var notes = (req.LineNotes ?? new())
            .GroupBy(x => x.LineId)
            .ToDictionary(g => g.Key, g => g.First());
        var buf = RecordingExport.BuildDetailWorkbook(date, mode, rows, notes);
        return File(buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"recording-{date}.xlsx");
    }

    // 按子件名+部位名(快照)求该部位订单需求量
    static int PartDemandByName(IEnumerable<OrderLine> lines, string itemName, string partName)
        => lines.Where(l => l.ItemName == itemName)
            .Sum(l => l.PartQtys.Where(q => q.PartName == partName).Sum(q => q.Qty));
}
