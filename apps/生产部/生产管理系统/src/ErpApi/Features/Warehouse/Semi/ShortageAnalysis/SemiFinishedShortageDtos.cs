namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public sealed class SemiFinishedShortageQuery
{
    public string Field { get; set; } = "productCode";
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public sealed class SemiFinishedShortageRow
{
    public string Customer { get; set; } = "";
    public string ProductCode { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string PartCode { get; set; } = "";
    public string AssemblyName { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal RequiredQuantity { get; set; }
    public decimal InventoryQuantity { get; set; }
    public decimal ShortageQuantity { get; set; }
}

public sealed record SemiFinishedShortageResult(
    IReadOnlyList<SemiFinishedShortageRow> Items,
    int Total,
    int Page,
    int PageSize);
