namespace ErpApi.Features.Warehouse.Semi.Labels;

public sealed class SemiLabelQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }        // 明细：'0'/'1'/null(全部)
    public bool MaterialOnly { get; set; }   // 汇总：物料查询(共用物料)，仅按配件编号汇总
}
public sealed class SemiLabelSummaryRow
{
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 每箱数量 { get; set; }
    public int 预计标签数 { get; set; }
    public int 实需标签数 { get; set; }
}
public sealed class SemiLabelDetailRow
{
    public DateTime 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 每箱数量 { get; set; }
    public int 预计标签数 { get; set; }
    public int 实需标签数 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
