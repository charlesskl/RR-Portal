namespace QcInspection.Api.Entities;

public sealed class InspectionAlert
{
    public long Id { get; set; }
    public long InspectionRecordId { get; set; }
    public string Site { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string BeforeJson { get; set; } = string.Empty;
    public string AfterJson { get; set; } = string.Empty;
    public string Status { get; set; } = "待处理";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string HandledBy { get; set; } = string.Empty;
    public DateTime? HandledAt { get; set; }
}
