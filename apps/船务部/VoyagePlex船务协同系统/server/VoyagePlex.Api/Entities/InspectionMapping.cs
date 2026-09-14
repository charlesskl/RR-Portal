namespace VoyagePlex.Api.Entities;

public sealed class InspectionMapping
{
    public long Id { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public string InspectionSource { get; set; } = string.Empty;
    public bool IsExcluded { get; set; }
    public string Customer { get; set; } = string.Empty;
    public string ProductCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string Owner { get; set; } = string.Empty;
    public string ProductionPlace { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
