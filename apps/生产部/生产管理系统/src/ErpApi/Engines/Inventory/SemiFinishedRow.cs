namespace ErpApi.Engines.Inventory;
public sealed class SemiFinishedRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal 库存 { get; set; }
}
