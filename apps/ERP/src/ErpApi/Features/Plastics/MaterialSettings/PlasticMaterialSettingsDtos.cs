using System.ComponentModel.DataAnnotations;

namespace ErpApi.Features.Plastics.MaterialSettings;

public sealed class PlasticMaterialSettingSaveDto
{
    [StringLength(80)]
    public string? 默认仓库 { get; set; }
    [Range(0, 100)]
    public decimal? 损耗率 { get; set; }
    [StringLength(500)]
    public string? 备注 { get; set; }
}

// 下游消费(塑胶单据预填默认仓库)的轻量查询结果:只含设置参数,不带列表列。
public sealed class PlasticMaterialSettingLookup
{
    public string 物料编号 { get; set; } = "";
    public string? 默认仓库 { get; set; }
    public decimal? 损耗率 { get; set; }
}

public sealed class PlasticMaterialSettingRow
{
    public long? ID { get; set; }
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 默认仓库 { get; set; }
    public decimal? 损耗率 { get; set; }
    public string? 备注 { get; set; }
    public string? 操作员 { get; set; }
    public DateTime? 更新时间 { get; set; }
}
