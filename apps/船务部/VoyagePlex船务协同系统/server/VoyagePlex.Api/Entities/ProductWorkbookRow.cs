namespace VoyagePlex.Api.Entities;

public sealed class ProductWorkbookRow
{
    public string Filename { get; set; } = string.Empty;
    public int RowNumber { get; set; }
    public string Customer { get; set; } = string.Empty;
    public string ProductCode { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int? QuantityPerBox { get; set; }
    public string ToyCategory { get; set; } = string.Empty;
    public decimal? GrossWeightPerBox { get; set; }
    public decimal? NetWeightPerBox { get; set; }
    public List<string> Warnings { get; set; } = [];
    public long? ExistingId { get; set; }
    public ProductInfo? ExistingProduct { get; set; }
    public bool UpdateExisting { get; set; }
}

public sealed class ProductWorkbookCommitRequest
{
    public List<ProductWorkbookRow> Rows { get; set; } = [];
}
