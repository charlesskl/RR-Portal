namespace SprayPlan.Api.Features.Orders;

// ===== 入参 =====
public record CreateOrderPartQtyDto(string? PartName, int? SourcePartId, int? Qty, int? PartOrder);
public record CreateOrderLineDto(string? ItemName, int? SourceItemId, List<CreateOrderPartQtyDto>? PartQtys);
public record CreateOrderRequest(string? ExternalOrderNo, int? ProductId, string? OrderDate, string? DeliveryDate, string? Remark, bool? IsMA, bool? IsUrgent, List<CreateOrderLineDto>? Lines);

public record UpdateOrderRequest(string? DeliveryDate, string? Remark, string? Status, bool? IsMA, bool? IsUrgent, string? OrderDate, List<UpdateOrderLineDto>? Lines);
// 明细数量编辑入参：按 partQty 主键 id 改 qty（仅 received 且无排期计划的订单允许，用于修正导入识别错误）
public record UpdateOrderPartQtyDto(int Id, int Qty);
public record UpdateOrderLineDto(List<UpdateOrderPartQtyDto>? PartQtys);

// ===== 出参 =====
// TotalQty = 全部位加工件数合计（各行各部位 qty 之和）
public record OrderListItem(int Id, string ExternalOrderNo, string ProductNo, DateTime OrderDate, DateTime? DeliveryDate, string Status, bool IsMA, bool IsUrgent, int TotalQty, bool PendingProduct);
public record OrderCreated(int Id, string ExternalOrderNo, string Status, bool IsMA, bool IsUrgent);
public record OrderHeadUpdated(int Id, string ExternalOrderNo, string Status, bool IsMA, bool IsUrgent);
public record OrderIdStatus(int Id, string Status);

// 详情嵌套
public record OrderPartQtyDto(int Id, string PartName, int? SourcePartId, int Qty, int PartOrder);
public record OrderLineDetailDto(int Id, string ItemName, int? SourceItemId, int LineOrder, List<OrderPartQtyDto> PartQtys);
public record OrderProductPartDto(int Id, string PartName, double UnitCost, double LaborPrice, double PaintCost, double QuotedPrice);
public record OrderProductItemDto(int Id, string ItemName, List<OrderProductPartDto> Parts);
public record OrderProductDto(int Id, string ProductNo, List<OrderProductItemDto> Items);
// QtyEditable：数量是否可改 = 已接单(received) 且 无未删排期计划。前端据此决定明细数量是否可编辑，与后端 PATCH 校验同口径。
public record OrderDetail(int Id, string ExternalOrderNo, int? ProductId, DateTime OrderDate, DateTime? DeliveryDate, string Status, bool IsMA, bool IsUrgent, string? Remark, string CreatedBy, OrderProductDto? Product, List<OrderLineDetailDto> Lines, bool QtyEditable);
