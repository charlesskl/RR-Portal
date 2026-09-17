namespace QcInspection.Api.Entities;

public sealed class InspectionResultApproval
{
    public long Id { get; set; }
    public long InspectionRecordId { get; set; }
    public string Site { get; set; } = string.Empty;
    public string PreviousInternalResult { get; set; } = string.Empty;
    public string PreviousThirdPartyResult { get; set; } = string.Empty;
    public string RequestedInternalResult { get; set; } = string.Empty;
    public string RequestedThirdPartyResult { get; set; } = string.Empty;
    public string RequestedHoldRejectReason { get; set; } = string.Empty;
    public string RequestedNote { get; set; } = string.Empty;
    public string Status { get; set; } = "待审批";
    public string RequestedBy { get; set; } = string.Empty;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public string ReviewedBy { get; set; } = string.Empty;
    public DateTime? ReviewedAt { get; set; }
    public string ReviewComment { get; set; } = string.Empty;
}
