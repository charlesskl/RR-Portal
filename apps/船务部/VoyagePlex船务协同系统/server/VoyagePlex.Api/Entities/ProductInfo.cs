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
    public decimal? NetNetWeightPerBox { get; set; }
    public string BoxDimensions { get; set; } = string.Empty;
    public string Brand { get; set; } = string.Empty;
    public decimal? MeasurementPerBox { get; set; }
    public decimal? VolumePerBox { get; set; }
    public string Source { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
