namespace StitchCostPro.Api.Entities;

/// <summary>外部订单中的货号＋款式名称与系统产品之间的人工确认映射。</summary>
public class ProductImportAlias : AuditableEntity
{
    public int AliasId { get; set; }
    public string ProductCode { get; set; } = null!;
    public string ExternalName { get; set; } = null!;
    public int ProductId { get; set; }
    public Product? Product { get; set; }
}
