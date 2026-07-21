namespace SprayPlan.Api.Features.Products;

// ===== 入参 =====
public record CreatePartDto(string? PartName, int? PartOrder, double? UnitCost, double? LaborPrice, double? PaintCost, double? QuotedPrice, string? Craft, string? Remark, int? DailyCapacity, int? CraftPasses);
public record CreateItemDto(string? ItemName, int? ItemOrder, List<CreatePartDto>? Parts);
public record CreateProductRequest(string? ProductNo, string? Remark, List<CreateItemDto>? Items);

public record UpdateProductRequest(string? IterationNo, string? Status, string? EffectiveDate, string? Remark);

public record AddItemRequest(string? ItemName, int? ItemOrder, List<CreatePartDto>? Parts);
public record UpdateItemRequest(string? ItemName);

public record AddPartRequest(int? ItemId, string? PartName, int? PartOrder, double? UnitCost, double? LaborPrice, double? PaintCost, double? QuotedPrice, string? Craft, string? Remark, int? DailyCapacity, int? CraftPasses);
public record UpdatePartRequest(string? PartName, double? UnitCost, double? LaborPrice, double? PaintCost, double? QuotedPrice, string? Craft, string? Remark, int? DailyCapacity, string? ProductionMode, int? StdMachineCount, int? CraftPasses);
public record SavePricingPartRequest(int Id, string? PartName, double? UnitCost, double? LaborPrice, double? PaintCost, double? QuotedPrice, string? Craft, string? Remark, int? DailyCapacity, string? ProductionMode, int? StdMachineCount, int? CraftPasses);
public record SavePricingTableRequest(List<SavePricingPartRequest>? Parts);

// ===== 出参（字段严格对齐现有 /api/products 返回结构）=====
public record PartDto(int Id, int ItemId, string PartName, int PartOrder, double UnitCost, double LaborPrice, double PaintCost, double QuotedPrice, string Craft, string CraftDetail, int DailyCapacity, string ProductionMode, int StdMachineCount, string? Remark, int CraftPasses);
public record ItemDto(int Id, int ProductId, string ItemName, int ItemOrder, List<PartDto> Parts);
public record ItemWithParts(int Id, int ProductId, string ItemName, int ItemOrder);

// 列表聚合：TotalUnitCost=核价合计、TotalPaintCost=油漆合计（前端 总核价=核价+油漆）
public record ProductListItem(int Id, string ProductNo, string IterationNo, string Status, DateTime? EffectiveDate, int ItemCount, double TotalUnitCost, double TotalPaintCost, double TotalQuotedPrice, string? LastUpdatedBy, DateTime UpdatedAt);
public record ProductDetail(int Id, string ProductNo, string IterationNo, string Status, DateTime? EffectiveDate, string? Remark, string CreatedBy, DateTime CreatedAt, string? LastUpdatedBy, DateTime UpdatedAt, List<ItemDto> Items);
public record ProductCreated(int Id, string ProductNo, string Status);
public record ProductHeadUpdated(int Id, string ProductNo, string IterationNo, string Status);
public record IdStatus(int Id, string Status);
public record PartUpdated(int Id, string PartName, double UnitCost, double LaborPrice, double PaintCost, double QuotedPrice, string Craft, string? Remark, int DailyCapacity, string ProductionMode, int StdMachineCount, int CraftPasses);
