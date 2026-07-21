namespace SprayPlan.Api.Entities;

// 订单行（子件）下各部位数量，对应表 order_part_qtys。接单按部位填，不分颜色/规格。
public class OrderPartQty
{
    public int Id { get; set; }
    public int OrderLineId { get; set; }
    public string PartName { get; set; } = "";   // 部位快照名
    public int? SourcePartId { get; set; }       // 溯源产品库部位
    public int Qty { get; set; }
    public int PartOrder { get; set; }

    public OrderLine? Line { get; set; }
}
