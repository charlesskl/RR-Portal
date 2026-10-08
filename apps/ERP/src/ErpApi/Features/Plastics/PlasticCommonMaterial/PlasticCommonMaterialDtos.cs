namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

// 塑胶共用物料表·行(全列;加工单价等价格字段按权限脱敏)
public sealed class PlasticCommonMaterialRow
{
    public long ID { get; set; }
    public string? 客户 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 整啤净重 { get; set; }
    public decimal? 原胶件单净重 { get; set; }
    public decimal? 整啤模腔数 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal? 用量 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 共用原料编号 { get; set; }
    public string? 调整审核 { get; set; }
    public string? 备注内容 { get; set; }
    public string? 工模表备注 { get; set; }
    public decimal? 出模数 { get; set; }
    public decimal? 水口比例 { get; set; }
    public decimal? 整啤毛重 { get; set; }
    public decimal? 模具日产量 { get; set; }
    public string? 啤机机型 { get; set; }
    public decimal? 啤机价钱 { get; set; }
    public decimal? 胶件啤工价 { get; set; }
    public decimal? 胶料单价 { get; set; }
    public decimal? 原胶料单价 { get; set; }
    public decimal? 加工总单价 { get; set; }
    public decimal? 其它成本 { get; set; }
    public string? 二次加工内容 { get; set; }
}
