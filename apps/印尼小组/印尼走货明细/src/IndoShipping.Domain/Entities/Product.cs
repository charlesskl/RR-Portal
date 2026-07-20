namespace IndoShipping.Domain.Entities;

public class Product
{
    public string Code { get; set; } = "";
    public string? Name { get; set; }
    public string? HsCn { get; set; }
    public string? HsId { get; set; }
    public string? Customer { get; set; }
    public string? Moldings { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public List<Material> Materials { get; set; } = new();
}
