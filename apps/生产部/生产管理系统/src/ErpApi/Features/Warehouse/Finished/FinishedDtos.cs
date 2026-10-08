namespace ErpApi.Features.Warehouse.Finished;

// ---- 入仓 ----
// 成品入仓（玩具模型·自由选产品版）：配件编号/订单单号/客户/产品货号/产品名称/产品装配名称/生产单号/箱数/数量。
public sealed class FinishedReceiptLineDto
{
    public string? 订单单号 { get; set; }
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 箱数 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedReceiptCreateDto
{
    public DateTime? 日期 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 订单单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 箱数 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedReceiptProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class FinishedReceiptProductRow
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 库存单价 { get; set; }
}
public sealed class FinishedReceiptDetailDto
{
    public FinishedReceiptHeaderDto? 单头 { get; set; }
    public List<FinishedReceiptLineRowDto> 明细 { get; set; } = [];
}

// ---- 出仓 ----
public sealed class FinishedIssueLineDto
{
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
}
public sealed class FinishedIssueCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 订单单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedIssueLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedIssueLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 成本单价 { get; set; }
    public decimal? 成本金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedIssueDetailDto
{
    public FinishedIssueHeaderDto? 单头 { get; set; }
    public List<FinishedIssueLineRowDto> 明细 { get; set; } = [];
}

// ---- 盘点 ----
public sealed class FinishedStocktakeBasisRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 系统数量 { get; set; }
}
public sealed class FinishedStocktakeLineDto
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}
public sealed class FinishedStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<FinishedStocktakeLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}
public sealed class FinishedStocktakeDetailDto
{
    public FinishedStocktakeHeaderDto? 单头 { get; set; }
    public List<FinishedStocktakeLineRowDto> 明细 { get; set; } = [];
}

// ===== 成品调拨 =====
public sealed class FinishedTransferLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedTransferCreateDto
{
    public string 源仓库 { get; set; } = "";
    public string 目标仓库 { get; set; } = "";
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 出仓单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedTransferLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedTransferHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedTransferLineRowDto
{
    public long ID { get; set; }
    public string? 源仓库 { get; set; }
    public string? 目标仓库 { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedTransferDetailDto
{ public FinishedTransferHeaderDto? 单头 { get; set; } public List<FinishedTransferLineRowDto> 明细 { get; set; } = []; }

// ===== 成品退货（客户退回，入仓库 +）=====
public sealed class FinishedSalesReturnLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedSalesReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 出仓单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedSalesReturnLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedSalesReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedSalesReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedSalesReturnDetailDto
{ public FinishedSalesReturnHeaderDto? 单头 { get; set; } public List<FinishedSalesReturnLineRowDto> 明细 { get; set; } = []; }

// ===== 成品退仓（退供应商，出仓库 −）=====
public sealed class FinishedVendorReturnLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedVendorReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedVendorReturnLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedVendorReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedVendorReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedVendorReturnDetailDto
{ public FinishedVendorReturnHeaderDto? 单头 { get; set; } public List<FinishedVendorReturnLineRowDto> 明细 { get; set; } = []; }

// ===== 退类带出原单基准（从原 出仓/入仓 明细单带行）=====
public sealed class FinishedSalesReturnBasisRow
{ public string? 客户编号 {get;set;} public string? 客户名称 {get;set;} public string? 仓库 {get;set;} public string? 生产单号 {get;set;}
  public string? 款号 {get;set;} public string? 款式 {get;set;} public string? 床号 {get;set;} public string? 色号 {get;set;}
  public string? 颜色 {get;set;} public string? 尺码 {get;set;} public decimal? 数量 {get;set;} public decimal? 单价 {get;set;} }
public sealed class FinishedVendorReturnBasisRow
{ public string? 供应商编号 {get;set;} public string? 供应商名称 {get;set;} public string? 仓库 {get;set;} public string? 生产单号 {get;set;}
  public string? 款号 {get;set;} public string? 款式 {get;set;} public string? 床号 {get;set;} public string? 色号 {get;set;}
  public string? 颜色 {get;set;} public string? 尺码 {get;set;} public decimal? 数量 {get;set;} public decimal? 单价 {get;set;} }
