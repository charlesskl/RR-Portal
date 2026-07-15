namespace IndoShipping.Domain.Entities;

public class Shipment
{
    public int Id { get; set; }
    public string? Customer { get; set; }
    public string? ContainerNo { get; set; }
    public int ContainerCount { get; set; } = 1;
    public DateOnly? ShipDate { get; set; }
    public string? BlNo { get; set; }
    public decimal Rate { get; set; } = 0.93m;
    public string Status { get; set; } = "draft";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ShipmentItem> Items { get; set; } = new();
}

public class ShipmentItem
{
    public int Id { get; set; }
    public int ShipmentId { get; set; }
    public int? MaterialId { get; set; }
    public int? Seq { get; set; }
    public decimal? Kg { get; set; }
    public decimal? Qty { get; set; }
    public int? Cartons { get; set; }
    public string? QtyPerCarton { get; set; }
    public string? Pallet { get; set; }
    public decimal? Price { get; set; }
    public string Currency { get; set; } = "¥";
    public string? PoNo { get; set; }
    public DateOnly? PoDate { get; set; }
    public string? Supplier { get; set; }
    public string? CustomsCompany { get; set; }
    public string? BlHead { get; set; }
    public string? ContractNo { get; set; }
    public DateOnly? ContractDate { get; set; }
    public string? InvoiceNo { get; set; }
    public DateOnly? InvoiceDate { get; set; }
    public decimal? InvoicePrice { get; set; }
    public string? ProductUse { get; set; }
    public string? FormulaName { get; set; }
}
