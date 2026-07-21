using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Schedule;

// 月排自动化 DTO。生成预览 = 草稿 + 提示清单（不落库）；保存/重排 = 把草稿写库。

// 生成预览请求：month 排期月(YYYY-MM)、mode(incremental|rebuild)、today(YYYY-MM-DD)。
public record AutoScheduleRequest(string? Month, string? Mode, string? Today);

// 草稿行：算法 PlanRow + 订单/产品展示字段（前端表格直接用）。
public record DraftRow(int OrderId, string ExternalOrderNo, string ProductNo,
    int SourcePartId, string ItemName, string PartName, string PlanDate, int PlannedQty,
    string? OrderDate, string? DeliveryDate, int LineId, string LineName,
    int StepNo, string Craft);

// 提示项：哪一单 + 原因码（overdue/no_delivery/ma_skipped/existing_skipped/no_line）。
public record AutoHint(int OrderId, string ExternalOrderNo, string Reason);

// 生成预览结果：草稿 + 各类提示清单（含无拉别订单）。
public record AutoScheduleResult(
    string Month, string Mode, List<DraftRow> Draft,
    List<AutoHint> OverdueOrders, List<MonthlyScheduleCalc.OverloadDay> OverloadedDays,
    List<AutoHint> NoDeliveryOrders, List<AutoHint> MaOrders, List<AutoHint> SkippedExisting,
    List<AutoHint> NoLineOrders, List<AutoHint> NoCapacityOrders);

// 保存请求：草稿含真实拉别（由算法分配），落库按行写 LineId。
public record CommitAutoRequest(string? Month, string? Mode, List<DraftRow>? Draft);
public record CommitAutoResult(int Created, int Cleared);
