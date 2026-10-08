namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiStockReturnLineInput
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStockReturnCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiStockReturnLineInput> 明细 { get; set; } = [];
}
public sealed class SemiStockReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 部门 { get; set; }
    public string? 退料人 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStockReturnLineRowDto
{
    public long ID { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStockReturnDetailDto
{ public SemiStockReturnHeaderDto? 单头 { get; set; } public List<SemiStockReturnLineRowDto> 明细 { get; set; } = []; }
public sealed class SemiStockReturnProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiStockReturnProductRow
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 库存单价 { get; set; }
}
