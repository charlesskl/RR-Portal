namespace IndoShipping.Domain.Entities;

public class Material
{
    public int Id { get; set; }
    public string? ProductCode { get; set; }
    public string? ItemNo { get; set; }
    public string? NameZh { get; set; }
    public string? NameEn { get; set; }
    public string? Spec { get; set; }
    public string? Category { get; set; }
    public string? MaterialCode { get; set; }
    public string? HsCn { get; set; }
    public string? HsId { get; set; }
    public string? Supplier { get; set; }
    public string? CustomsCompany { get; set; }
    public string UnitKg { get; set; } = "KGM";
    public decimal GrossPerPc { get; set; }
    public decimal NetPerPc { get; set; }
    public decimal Length { get; set; }
    public decimal Width { get; set; }
    public decimal Height { get; set; }
    public decimal QtyPerCarton { get; set; }
    public decimal WeightPerCarton { get; set; }
    public string? ImageId { get; set; }
    public bool Active { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
