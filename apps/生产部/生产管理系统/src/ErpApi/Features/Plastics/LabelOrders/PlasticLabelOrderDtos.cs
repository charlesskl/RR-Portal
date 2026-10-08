using System.ComponentModel.DataAnnotations;
using ErpApi.Features.Warehouse.Semi.Labels;

namespace ErpApi.Features.Plastics.LabelOrders;

public sealed class PlasticLabelOrderLineDto
{
    public long? ID { get; set; }
    [StringLength(80)]
    public string 物料编号 { get; set; } = "";
    [StringLength(240)]
    public string? 物料名称 { get; set; }
    [StringLength(240)]
    public string? 规格 { get; set; }
    [StringLength(80)]
    public string? 颜色 { get; set; }
    [StringLength(40)]
    public string? 单位 { get; set; }
    [Decimal18_4]
    public decimal 数量 { get; set; }
    [Range(0, int.MaxValue)]
    public int 标签数 { get; set; }
    [StringLength(500)]
    public string? 备注 { get; set; }
}

public sealed class PlasticLabelOrderSaveDto
{
    public DateTime 日期 { get; set; }
    [StringLength(500)]
    public string? 备注一 { get; set; }
    [StringLength(500)]
    public string? 备注二 { get; set; }
    public List<PlasticLabelOrderLineDto?> 明细 { get; set; } = [];
}

public sealed class PlasticLabelOrderDto
{
    public long ID { get; set; }
    public string 电脑单号 { get; set; } = "";
    public DateTime 日期 { get; set; }
    public string? 备注一 { get; set; }
    public string? 备注二 { get; set; }
    public string 操作员 { get; set; } = "";
    public string 审核 { get; set; } = "0";
    public string? 审核人 { get; set; }
    public DateTime? 审核时间 { get; set; }
    public List<PlasticLabelOrderLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticLabelOrderListRow
{
    public long ID { get; set; }
    public string 电脑单号 { get; set; } = "";
    public DateTime 日期 { get; set; }
    public string 操作员 { get; set; } = "";
    public string 审核 { get; set; } = "0";
    public string? 审核人 { get; set; }
    public DateTime? 审核时间 { get; set; }
    public string? 备注一 { get; set; }
    public string? 备注二 { get; set; }
}

// 塑胶标签查询·明细行：每行一条标签明细(含单头日期/审核,双击 电脑单号 看整单)。无价格列。
public sealed class PlasticLabelQueryDetailRow
{
    public DateTime 日期 { get; set; }
    public string 电脑单号 { get; set; } = "";
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public int 标签数 { get; set; }
    public string? 备注 { get; set; }
    public string 审核 { get; set; } = "0";
}

// 塑胶标签查询·汇总行：按 物料编号+规格+颜色 合并 数量与标签数。
public sealed class PlasticLabelQuerySummaryRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public int 标签数 { get; set; }
}

public sealed class PlasticLabelMaterialQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 20;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}

public sealed class PlasticLabelMaterialRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
}
