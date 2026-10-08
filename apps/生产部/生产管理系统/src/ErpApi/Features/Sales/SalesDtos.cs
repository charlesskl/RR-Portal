namespace ErpApi.Features.Sales;

// ---- 销售出货 ----
public sealed class SalesShipmentLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SalesShipmentCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesShipmentLineDto> 明细 { get; set; } = [];
}
public sealed class SalesShipmentHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesShipmentLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 库存单价 { get; set; }
    public decimal? 库存金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesShipmentDetailDto
{ public SalesShipmentHeaderDto? 单头 { get; set; } public List<SalesShipmentLineRowDto> 明细 { get; set; } = []; }

// ---- 销售退货 ----
public sealed class SalesReturnLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SalesReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 销售单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesReturnLineDto> 明细 { get; set; } = [];
}
public sealed class SalesReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 销售单号 { get; set; }
    public string? 客户编号 { get; set; }
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
public sealed class SalesReturnLineRowDto
{
    public long ID { get; set; }
    public string? 销售单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 库存单价 { get; set; }
    public decimal? 库存金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReturnDetailDto
{ public SalesReturnHeaderDto? 单头 { get; set; } public List<SalesReturnLineRowDto> 明细 { get; set; } = []; }
public sealed class SalesReturnBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
}

// ---- 销售收款（客户级挂账） ----
public sealed class SalesReceiptLineDto
{ public string? 客户编号 { get; set; } public string? 客户名称 { get; set; } public decimal 收款金额 { get; set; } public decimal? 货款金额 { get; set; } public decimal? 应收金额 { get; set; } public string? 出仓单号 { get; set; } }
public sealed class SalesReceiptCreateDto
{
    public string? 出仓单号 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class SalesReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 出仓单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 出仓单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal? 货款金额 { get; set; }
    public decimal? 收款金额 { get; set; }
    public decimal? 应收金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReceiptDetailDto
{ public SalesReceiptHeaderDto? 单头 { get; set; } public List<SalesReceiptLineRowDto> 明细 { get; set; } = []; }

// ---- 应收对账 ----
public sealed class ReceivableRow
{
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal 出货金额 { get; set; }
    public decimal 收款金额 { get; set; }
    public decimal 退货金额 { get; set; }
    public decimal 应收余额 { get; set; }
}

// ---- 应收逐单核销 / 账龄 / 待核销出货单 ----
public sealed class ReceivableSettlementRow
{
    public string? 出货单号 { get; set; }
    public DateTime? 出货日期 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal 应收金额 { get; set; }
    public decimal 退货金额 { get; set; }
    public decimal 已收金额 { get; set; }
    public decimal 未核销余额 { get; set; }
}
public sealed class ReceivableAgingRow
{
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal 账龄0_30 { get; set; }
    public decimal 账龄31_60 { get; set; }
    public decimal 账龄61_90 { get; set; }
    public decimal 账龄90以上 { get; set; }
    public decimal 合计 { get; set; }
}
public sealed class UnsettledShipmentRow
{
    public string? 出货单号 { get; set; }
    public DateTime? 出货日期 { get; set; }
    public decimal 应收金额 { get; set; }
    public decimal 已收金额 { get; set; }
    public decimal 未核销余额 { get; set; }
}
