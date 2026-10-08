namespace ErpApi.Engines.Inventory;
// 成品库存（玩具模型）：按 配件编号 聚合的一行
public sealed class FinishedItemStockRow
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 库存数量 { get; set; }
}
