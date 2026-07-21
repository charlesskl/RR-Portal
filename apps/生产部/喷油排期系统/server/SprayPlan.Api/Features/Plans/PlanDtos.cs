namespace SprayPlan.Api.Features.Plans;

// ===== 入参 =====
public record CreatePlanRow(string? PlanDate, string? PlanType, int? LineId, int? OrderId, string? ItemName, string? PartName, int? SourcePartId, List<string>? MachineNos, double? PlannedQty, int? WorkerCount, int? StepNo, string? Craft);
public record CreatePlansRequest(List<CreatePlanRow>? Plans);
public record CreatePlansResult(int Count);

// PATCH：第6阶段处理计划字段；goodQty/defectQty/workHours 实绩分支第7阶段补
public record UpdatePlanRequest(double? PlannedQty, List<string>? MachineNos, int? WorkerCount, string? PlanDate, string? Remark, int? GoodQty, int? ReportedQty, int? DefectQty, double? WorkHours, int? LineId, int? StepNo, string? Craft);

// ===== 出参 =====
public record PlanUpdated(int Id, int? GoodQty, double? ProductionValue, string Status, int PlannedQty, List<string> MachineNos);
public record PlanDeleted(int Id, DateTime? DeletedAt);
public record PlanDto(int Id, DateTime PlanDate, string PlanType, int LineId, int OrderId, string ItemName, string PartName, int? SourcePartId, List<string> MachineNos, int PlannedQty, int WorkerCount, int StepNo, string Craft, int? StandardStepCount, string? StandardCraft, bool CraftAdjusted, int? GoodQty, int? ReportedQty, int DefectQty, double WorkHours, double? ProductionValue, string Status, string? Remark, string CreatedBy, DateTime CreatedAt, string? LastModifiedBy, DateTime LastModifiedAt, string ModificationHistory, DateTime? DeletedAt, string? DeletedBy);
