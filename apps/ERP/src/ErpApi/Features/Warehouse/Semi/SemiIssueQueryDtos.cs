namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiIssueQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 制单人 { get; set; }
    public bool MaterialOnly { get; set; }
    public bool ByIssueRemark { get; set; } = true;   // 汇总：按领料备注
}
public sealed class SemiIssueSummaryRow
{
    public string? 领料备注 { get; set; }
    public string? 装配采购 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 领料数量 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiIssueDetailRow
{
    public string? 领料备注 { get; set; }
    public string? 装配采购 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 领料人 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 审核 { get; set; }
}
