namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiWhReturnQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }
    public bool MaterialOnly { get; set; }
    public bool BySupplier { get; set; }
}
public sealed class SemiWhReturnSummaryRow
{
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public decimal 退仓数量 { get; set; }
}
public sealed class SemiWhReturnDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
