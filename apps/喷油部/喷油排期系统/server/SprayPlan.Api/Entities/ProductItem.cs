namespace SprayPlan.Api.Entities;

// 子件 product_items：一个产品多个子件（如套装的兔子/青蛙）。
public class ProductItem
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public string ItemName { get; set; } = "";
    public int ItemOrder { get; set; }

    public Product? Product { get; set; }
    public List<ProductPart> Parts { get; set; } = new();
}
