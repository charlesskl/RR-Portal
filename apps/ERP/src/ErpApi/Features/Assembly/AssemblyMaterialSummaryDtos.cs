namespace ErpApi.Features.Assembly;

public sealed class AssemblyMaterialSummaryRow
{
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 装配方式 { get; set; }
    public decimal? 对比相差 { get; set; }
    public string? 相关比例 { get; set; }
    public string? 仓库位置 { get; set; }
    public decimal? 需求用量 { get; set; }
    public string? 操作员 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyMaterialDetailRow
{
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 材料 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public string? 备注 { get; set; }
    public string? 操作员 { get; set; }
}

public sealed class AssemblyMaterialSummaryResult
{
    public List<AssemblyMaterialSummaryRow> 汇总 { get; set; } = new();
    public List<AssemblyMaterialDetailRow> 明细 { get; set; } = new();
}
