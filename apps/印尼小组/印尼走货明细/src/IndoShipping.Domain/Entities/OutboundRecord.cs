namespace IndoShipping.Domain.Entities;

public class OutboundRecord
{
    public int Id { get; set; }
    public string? PoNo { get; set; }
    public int? MaterialId { get; set; }
    public decimal? Qty { get; set; }
    public DateOnly? OutDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
