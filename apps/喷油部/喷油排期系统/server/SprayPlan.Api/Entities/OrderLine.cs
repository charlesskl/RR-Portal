namespace SprayPlan.Api.Entities;

// 勾选的「子件」明细行（抄快照名 + 溯源 FK），数量下沉到部位级。
public class OrderLine
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public string ItemName { get; set; } = "";       // 快照名
    public int? SourceItemId { get; set; }
    public int LineOrder { get; set; }

    public Order? Order { get; set; }
    public List<OrderPartQty> PartQtys { get; set; } = new();
}
