namespace ErpApi.Engines.Inventory;
// 成品库存流水（玩具模型）：某配件编号在指定仓库的一条出入库记录
public sealed class FinishedItemLedgerRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string 类型 { get; set; } = "";
    public decimal? 入库数量 { get; set; }
    public decimal? 出库数量 { get; set; }
}
