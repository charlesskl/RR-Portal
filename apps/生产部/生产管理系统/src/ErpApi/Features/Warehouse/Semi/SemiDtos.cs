namespace ErpApi.Features.Warehouse.Semi;

// ---- 入仓 ----
public sealed class SemiReceiptLineDto
{
    public string? 订单单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiReceiptCreateDto
{
    public DateTime? 日期 { get; set; }
    public string? 订单单号 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 部门 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class SemiReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 部门 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 订单单号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiReceiptDetailDto
{ public SemiReceiptHeaderDto? 单头 { get; set; } public List<SemiReceiptLineRowDto> 明细 { get; set; } = []; }

// ---- 领料（半成品出库单 · 自由选产品版）----
public sealed class SemiIssueLineInput
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
public sealed class SemiIssueCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 拉长 { get; set; }
    public string? 收件人 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 件数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 制单人 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiIssueLineInput> 明细 { get; set; } = [];
}
public sealed class SemiIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 拉长 { get; set; }
    public string? 收件人 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 件数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 制单人 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 主管审核 { get; set; }        // 三级流转第一级：主管审核('1'=已审)
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }        // 三级流转第二级：经理审核
    public string? 经理审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiIssueLineRowDto
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
public sealed class SemiIssueDetailDto
{ public SemiIssueHeaderDto? 单头 { get; set; } public List<SemiIssueLineRowDto> 明细 { get; set; } = []; }
public sealed class SemiIssueProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiIssueProductRow
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

// ---- 盘点（自由选产品版）----
// 配件编号=物料编号；产品装配名称=物料名称；产品货号=货号；产品名称=名称。库存/盈亏按 配件编号 汇总（不分颜色，与桌面版一致）。
public sealed class SemiStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal 系统数量 { get; set; }
}
public sealed class SemiStocktakeLineInput
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStocktakeCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<SemiStocktakeLineInput> 明细 { get; set; } = [];
}
public sealed class SemiStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStocktakeDetailDto
{ public SemiStocktakeHeaderDto? 单头 { get; set; } public List<SemiStocktakeLineRowDto> 明细 { get; set; } = []; }
public sealed class SemiStocktakeProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiStocktakeProductRow
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

// ---- 库存统计表（富化报表）----
public sealed class SemiInventoryReportQuery
{
    public string? 仓库 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public bool IncludeZero { get; set; }  // 零库存：含零(true)/只显示有库存(false)
    public bool ShowAll { get; set; }      // 显示：全部记录(true)/有发生的记录(false)
}
public sealed class SemiInventoryReportRow
{
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 库存数量 { get; set; }
    public string? 仓库位置 { get; set; }
}

// ---- 库存月报表（收发存）----
public sealed class SemiMonthlyReportQuery
{
    public DateTime? 起日期 { get; set; }
    public DateTime? 止日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiMonthlyReportRow
{
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 期初库存 { get; set; }
    public decimal 本期入库 { get; set; }
    public decimal 本期出库 { get; set; }
    public decimal 本期报废 { get; set; }
    public decimal 盘点盈亏 { get; set; }
    public decimal 期末库存 { get; set; }
}

// 半成品入仓齐套检查:组成物料需要量 = 半成品设置明细.使用数量(一套成品的用量) × 本次入仓套数;
// 已回 = 该生产单号下已审核塑胶入仓(外发加工回仓)按物料累计;还差 = max(0, 需要-已回)。
public sealed class SemiKitCheckLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal 每件用量 { get; set; }   // 口径:一套成品的用量(界面列名「每套用量」)
    public decimal 需要 { get; set; }
    public decimal 已回 { get; set; }
    public decimal 还差 { get; set; }
}
public sealed class SemiKitCheckDto
{
    // 配件编号没有半成品定义(非半成品行)时为 false,前端不提示
    public bool 有定义 { get; set; }
    public bool 齐套 { get; set; }
    public List<SemiKitCheckLineDto> 组成 { get; set; } = [];
}
