namespace SprayPlan.Api.Entities;

// 对应现有 prisma model Order（@@map("orders")）。订单头：一单一款号。
public class Order
{
    public int Id { get; set; }
    public string ExternalOrderNo { get; set; } = "";   // 外部订单号（唯一）
    public int? ProductId { get; set; }                 // 可空：待补产品订单无款号
    public DateTime OrderDate { get; set; }
    public DateTime? DeliveryDate { get; set; }
    public string Status { get; set; } = "received";    // received|scheduled|in_production|completed|archived
    public bool IsMA { get; set; }
    public bool IsUrgent { get; set; }                  // 急单标记（临时插入单）
    public bool PendingProduct { get; set; }            // 待补产品标记（PDF导入新货号时 true）
    public string? Remark { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? LastUpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Product? Product { get; set; }
    public List<OrderLine> Lines { get; set; } = new();
    public List<ProductionPlan> Plans { get; set; } = new();
}
