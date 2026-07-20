namespace IndoShipping.Domain.Entities;

public class PurchaseOrder
{
    public int Id { get; set; }
    public string? PoNo { get; set; }
    public string? Supplier { get; set; }
    public string Status { get; set; } = "draft";
    public DateOnly? OrderDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<PoItem> Items { get; set; } = new();
}

public class PoItem
{
    public int Id { get; set; }
    public int PoId { get; set; }
    public string? ProductCode { get; set; }
    public int? MaterialId { get; set; }
    public decimal? Qty { get; set; }
    public decimal? Price { get; set; }
    public string Currency { get; set; } = "¥";
    public string? Notes { get; set; }
}
