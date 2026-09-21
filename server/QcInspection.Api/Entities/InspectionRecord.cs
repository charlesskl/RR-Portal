namespace QcInspection.Api.Entities;

public sealed class InspectionRecord
{
    public long Id { get; set; }
    public string PlanId { get; set; } = string.Empty;
    public string ScheduleKey { get; set; } = string.Empty;
    public string ScheduleSource { get; set; } = string.Empty;
    public long? ScheduleCreatedBatchId { get; set; }
    public string Site { get; set; } = string.Empty;
    public DateTime? InspectionDate { get; set; }
    public string InspectionLocation { get; set; } = string.Empty;
    public string InspectionParty { get; set; } = string.Empty;
    public string ThirdPartyOrganization { get; set; } = string.Empty;
    public string Customer { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string ContractNumber { get; set; } = string.Empty;
    public string CustomerPo { get; set; } = string.Empty;
    public string ItemNumber { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal? Quantity { get; set; }
    public decimal? Cartons { get; set; }
    public DateTime? PlannedShipDate { get; set; }
    public string InternalResult { get; set; } = string.Empty;
    public string ThirdPartyResult { get; set; } = string.Empty;
    public string HoldRejectReason { get; set; } = string.Empty;
    public string ProductionWorkshop { get; set; } = string.Empty;
    public string ProductionSupervisor { get; set; } = string.Empty;
    public string ResponsibleLineLeader { get; set; } = string.Empty;
    public string ProblemSource { get; set; } = string.Empty;
    public string HandlingResult { get; set; } = string.Empty;
    public string TestScrap { get; set; } = string.Empty;
    public string PackagingSpec { get; set; } = string.Empty;
    public decimal? PackingQuantity { get; set; }
    public string ThirdPartyInspectionLocation { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public string WorkflowStatus { get; set; } = "待验货";
    public string SourceFile { get; set; } = string.Empty;
    public string SourceSheet { get; set; } = string.Empty;
    public int SourceRow { get; set; }
    public string Fingerprint { get; set; } = string.Empty;
    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ScheduleUpdatedAt { get; set; }
}
