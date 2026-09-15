namespace VoyagePlex.Api.Entities;

public sealed class ShipmentTask
{
    public long Id { get; set; }
    public string Customer { get; set; } = string.Empty;
    public string EmailSubject { get; set; } = string.Empty;
    public string? SoNumber { get; set; }
    public string ContainerType { get; set; } = string.Empty;
    public DateOnly? PlannedShipDate { get; set; }
    public string CutoffDate { get; set; } = string.Empty;
    public string SiDeadline { get; set; } = string.Empty;
    public string Port { get; set; } = string.Empty;
    public string DestinationCountry { get; set; } = string.Empty;
    public string TransportReference { get; set; } = string.Empty;
    public string SpecialRequirements { get; set; } = string.Empty;
    public string WarehouseGroupsJson { get; set; } = "[]";
    public string ItemsJson { get; set; } = "[]";
    public long? SourceImportItemId { get; set; }
    public string Status { get; set; } = "PendingReview";
    public DateOnly? CompletedDate { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
