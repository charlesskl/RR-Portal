namespace ErpApi.Engines.Inventory;
public sealed class InventoryRow
{
    public string 款号 { get; set; } = "";
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 库存 { get; set; }
}
