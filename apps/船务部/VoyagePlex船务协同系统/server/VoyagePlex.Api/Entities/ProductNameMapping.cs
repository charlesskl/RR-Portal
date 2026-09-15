namespace VoyagePlex.Api.Entities;

public sealed class ProductNameMapping
{
    public long Id { get; set; }
    public string ProductCodeKey { get; set; } = string.Empty;
    public int QuantityPerBox { get; set; }
    public string EnglishName { get; set; } = string.Empty;
    public string EnglishNameKey { get; set; } = string.Empty;
    public string ChineseName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
