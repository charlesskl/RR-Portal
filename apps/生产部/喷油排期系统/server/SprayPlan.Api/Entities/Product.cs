namespace SprayPlan.Api.Entities;

// 对应现有 prisma model Product（@@map("products")，货号唯一）。
// 一条 = 一个货号。
public class Product
{
    public int Id { get; set; }
    public string ProductNo { get; set; } = "";
    public string IterationNo { get; set; } = "V1";
    public string Status { get; set; } = "draft";   // draft|active|archived
    public DateTime? EffectiveDate { get; set; }
    public string? Remark { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? LastUpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<ProductItem> Items { get; set; } = new();
}
