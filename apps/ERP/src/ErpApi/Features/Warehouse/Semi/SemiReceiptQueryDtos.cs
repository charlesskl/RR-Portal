namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiReceiptQueryDto
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public string? 审核 { get; set; }        // 明细：'0'/'1'/null(全部)
    public bool MaterialOnly { get; set; }   // 物料查询(共用物料)：仅按配件编号汇总
    public bool BySupplier { get; set; }     // 汇总：按供应商
}
public sealed class SemiReceiptSummaryRow
{
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public decimal 入仓数量 { get; set; }
}
public sealed class SemiReceiptDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
