using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Schedule;

// 甘特图数据结构 —— 对应现有 scheduleData.ts 的 GanttPlan/DemandPart/GanttOrder。
public record GanttPlan(string PlanDate, string ItemName, string PartName, int? SourcePartId, int PlannedQty, int? GoodQty, int? ReportedQty, List<string> MachineNos, int WorkerCount);
public record DemandPart(int SourceItemId, string ItemName, int SourcePartId, string PartName, int TotalDemand);
public record GanttOrder(int Id, string ExternalOrderNo, string ProductNo, string Status,
    string? DeliveryDate, bool Scheduled, string? FirstPlanDate, string? ExpectedOutDate,
    List<GanttPlan> Plans, List<DemandPart> DemandParts);

// 排期录入页用：可排订单（received/scheduled/in_production）+ 展开部位清单。
// Parts 直接复用 ScheduleCalc.SchedulablePart（含 productionMode/dailyCapacity/stdMachineCount/totalDemand），
// 对齐前端 lib/schedule.ts 的 SchedulablePart 与 expandOrderParts 输出。
public record SchedulableOrder(int Id, string ExternalOrderNo, string ProductNo, bool IsMA, bool IsUrgent, bool Scheduled,
    List<ScheduleCalc.SchedulablePart> Parts);

// 排期总览看板（拉别 × 日期·只读）—— 对应 GET /api/schedule/overview。
// 后端只吐「拉别清单 + 区间内计划明细行（含 stepNo/craft）」；网格聚合、产能占用%、红黄绿由前端算。
// DailyLimit=该拉每天产能上限（件，0=不卡）；Craft=该道工序大类（手喷/自动喷/移印/UV），前端据此上色。
public record OverviewLine(int LineId, string Name, string CraftType, int DailyLimit);
public record OverviewPlan(int Id, int LineId, string Date, int OrderId, string ProductNo,
    string ItemName, string PartName, int StepNo, string Craft, int PlannedQty,
    List<string> MachineNos, int WorkerCount);
public record OverviewResult(List<OverviewLine> Lines, List<OverviewPlan> Plans);
