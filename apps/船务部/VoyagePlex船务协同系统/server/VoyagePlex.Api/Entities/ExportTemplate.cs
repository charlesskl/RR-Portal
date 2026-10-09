namespace VoyagePlex.Api.Entities;

public sealed class ExportTemplate : ICompanyEntity
{
    public long Id { get; set; }
    public string Company { get; set; } = "Xingxin";
    public string Name { get; set; } = "";
    public string ShipmentMode { get; set; } = "Container";
    public string Purpose { get; set; } = "Shipping";
    public string Version { get; set; } = "1.0";
    public string Notes { get; set; } = "";
    public bool IsEnabled { get; set; } = true;
    public bool IsDefault { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
