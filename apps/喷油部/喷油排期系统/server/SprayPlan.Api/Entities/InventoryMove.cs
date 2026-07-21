namespace SprayPlan.Api.Entities;

// 对应 prisma model InventoryMove（@@map("inventory_moves")）。库存流水：仅存"挪动"事件。
// 成品库存从实绩派生 + 本表 owner 出账叠加；散件库存 = 本表 owner=NULL 行求和。
public class InventoryMove
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public string ItemName { get; set; } = "";
    public string PartName { get; set; } = "";
    public int? OwnerOrderId { get; set; }     // 非空=该订单成品；NULL=无主散件
    public int Delta { get; set; }             // 正=进 / 负=出
    public string Reason { get; set; } = "";   // basket_overflow|tumbler_excess|assembly_pickup|reorder_consume
    public int? RefOrderId { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? Remark { get; set; }
}
