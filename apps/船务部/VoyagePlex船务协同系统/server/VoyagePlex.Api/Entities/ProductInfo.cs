namespace VoyagePlex.Api.Entities;

public sealed class ProductInfo
{
    public long Id { get; set; }
    public long LegacyId { get; set; }
    public string Customer { get; set; } = string.Empty;
    public string ProductCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int? QuantityPerBox { get; set; }
    public string ToyCategory { get; set; } = string.Empty;
    public string FactoryRemark { get; set; } = string.Empty;
    public decimal? GrossWeightPerBox { get; set; }
    public decimal? NetWeightPerBox { get; set; }
    public string Source { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
