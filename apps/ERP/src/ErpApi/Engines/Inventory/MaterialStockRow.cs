namespace ErpApi.Engines.Inventory;
public sealed class MaterialStockRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 库存数量 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 每单位数值 { get; set; }
    public string? 仓库位置 { get; set; }
}

public sealed class MaterialMonthlyRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 每单位数值 { get; set; }
    public string? 单位 { get; set; }
    public decimal 期初库存 { get; set; }
    public decimal 本期入库 { get; set; }
    public decimal 本期出库 { get; set; }
    public decimal 盘点盈亏 { get; set; }
    public decimal 期末库存 { get; set; }
    public string? 仓库 { get; set; }
    public string? 物料类别 { get; set; }
}
