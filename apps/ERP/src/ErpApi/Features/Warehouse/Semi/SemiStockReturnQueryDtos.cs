namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiStockReturnQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }
    public bool MaterialOnly { get; set; }
    public bool ByOrderNo { get; set; }   // 汇总：按装配采购单号汇总
}
public sealed class SemiStockReturnSummaryRow
{
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 退料数量 { get; set; }
}
public sealed class SemiStockReturnDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
