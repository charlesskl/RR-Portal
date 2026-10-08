using System.ComponentModel.DataAnnotations;

namespace ErpApi.Features.Materials.PurchaseSettings;

public sealed class PurchaseMaterialSettingSaveDto
{
    [StringLength(160)]
    public string? 默认供应商 { get; set; }
    [Range(0, 99999999999999.9999)]
    public decimal? 最小订量 { get; set; }
    [Range(0, 100)]
    public decimal? 采购损耗率 { get; set; }
    [StringLength(500)]
    public string? 备注 { get; set; }
}

// 下游消费(采购订单预填/采购分析损耗率)的轻量查询结果:只含设置参数,不带列表列。
public sealed class PurchaseMaterialSettingLookup
{
    public string 物料编号 { get; set; } = "";
    public string? 默认供应商 { get; set; }
    public decimal? 最小订量 { get; set; }
    public decimal? 采购损耗率 { get; set; }
}

public sealed class PurchaseMaterialSettingRow
{
    public long? ID { get; set; }
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 默认供应商 { get; set; }
    public decimal? 最小订量 { get; set; }
    public decimal? 采购损耗率 { get; set; }
    public string? 备注 { get; set; }
    public string? 操作员 { get; set; }
    public DateTime? 更新时间 { get; set; }
}
