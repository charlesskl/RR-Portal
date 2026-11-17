namespace SprayPlan.Api.Entities;

// 同一厂区内货号唯一；两厂区分别维护核价与工艺。
public class Product
{
    public int Id { get; set; }
    public string FactoryId { get; set; } = "XINGXIN";
    public string ProductNo { get; set; } = "";
    public string IterationNo { get; set; } = "V1";
    public string Status { get; set; } = "draft";   // draft|active|archived
    public DateTime? EffectiveDate { get; set; }
    public string? Remark { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? LastUpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }

    public List<ProductPart> Parts { get; set; } = new();
}
