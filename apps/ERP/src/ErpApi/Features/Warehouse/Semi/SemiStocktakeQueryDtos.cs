namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiStocktakeQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }
    public bool MaterialOnly { get; set; }
}
public sealed class SemiStocktakeQuerySummaryRow
{
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 系统数 { get; set; }
    public decimal 盘点数 { get; set; }
    public decimal 盈亏数 { get; set; }
}
public sealed class SemiStocktakeQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
    public decimal 盈亏数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
