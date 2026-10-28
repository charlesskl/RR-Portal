using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Orders;

// ===== 入参 =====
public record CreateOrderPartQtyDto(string? PartName, int? SourcePartId, int? Qty, int? PartOrder);
public record CreateOrderRequest(string? ExternalOrderNo, int? ProductId, string? OrderDate, string? DeliveryDate, string? Remark, bool? IsMA, bool? IsUrgent, List<CreateOrderPartQtyDto>? PartQtys);

public record UpdateOrderRequest(string? DeliveryDate, string? Remark, string? Status, bool? IsMA, bool? IsUrgent, string? OrderDate, List<UpdateOrderPartQtyDto>? PartQtys, int? TotalQty = null, bool AutoAdjustSchedule = false);
// 按订单部位明细主键独立更正需求，保留历史排期、实绩和库存。
public record UpdateOrderPartQtyDto(int Id, int Qty);
public record OrderProcessScheduleRow(string? StartDate, int? LineId, int? DailyTarget, int? PartQtyId = null, double? LaborPrice = null);
public record CreateOrderProcessScheduleRequest(List<OrderProcessScheduleRow>? Rows, List<UpdateOrderPartQtyDto>? PartQtys = null);
public record CreateOrderProcessScheduleResult(int CreatedPlans, string? StartDate, string? EndDate);
public record RevokeActualsRequest(string? Scope, string? Date);
public record ActualsDaySummary(string Date, int ProductionQty, int InboundQty);
public record OrderActualsSummary(int OrderId, int ProductionQty, int InboundQty, List<ActualsDaySummary> Days);
public record RevokeActualsResult(int ClearedPlans, int ProductionQty, int InboundQty, string Status);

// ===== 出参 =====
// TotalQty = 各部位需求的最大值，与订单总览 DemandQty 保持一致。
public record OrderListItem(int Id, string ExternalOrderNo, string ProductNo, DateTime OrderDate, DateTime? DeliveryDate, string Status, bool IsMA, bool IsUrgent, int TotalQty, bool PendingProduct);
public record OrderOverviewSummary(int Id, bool Scheduled, string? FirstPlanDate, string? ScheduleFinishDate,
    bool ScheduleCovered, int PlannedQty, int RecordedQty, int DemandQty, int ProgressPct,
    int PlanProductionDays, int FinishedQty, int RemainingQty, int InProductionRemainingQty);
public record OrderCreated(int Id, string ExternalOrderNo, string Status, bool IsMA, bool IsUrgent);
public record OrderHeadUpdated(int Id, string ExternalOrderNo, string Status, bool IsMA, bool IsUrgent, DemandScheduleResult? ScheduleAdjustment = null);
public record OrderIdStatus(int Id, string Status);

// 详情嵌套
public record OrderPartQtyDto(int Id, string PartName, int? SourcePartId, int Qty, int PartOrder);
public record OrderProductPartDto(int Id, string PartName, string Craft, int PartGroupId, double UnitCost, double LaborPrice, double PaintCost, double QuotedPrice, int DailyCapacity = 0);
public record OrderProductDto(int Id, string ProductNo, List<OrderProductPartDto> Parts);
// QtyEditable：非作废且已补全产品的订单允许更正需求，写入仍受角色鉴权。
public record OrderDetail(int Id, string ExternalOrderNo, int? ProductId, DateTime OrderDate, DateTime? DeliveryDate, string Status, bool IsMA, bool IsUrgent, string? Remark, string CreatedBy, OrderProductDto? Product, List<OrderPartQtyDto> PartQtys, bool QtyEditable,
    List<OrderProductDto>? Products = null, List<PartScheduleBalance>? ScheduleBalances = null);
