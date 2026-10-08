namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

public sealed class PlasticRawMaterialCategoryNode
{
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
}

public sealed class PlasticRawMaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 商品名称 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 起订量 { get; set; }
    public decimal? 安全库存 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialPurchaseRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 当前库存 { get; set; }
    public decimal? 安全库存 { get; set; }
    public decimal? 生产需求 { get; set; }
    public decimal? 在途数量 { get; set; }
    public decimal? 可购数量 { get; set; }
}
