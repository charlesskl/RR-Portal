using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.PurchaseReceipt;

public sealed class PurchaseReceiptCreateDto
{
    // 入仓单号=供应商送货单号（手填）；留空则按 CG+日期+流水 自动生成（兼容旧流程/辅料入仓）。
    // 手填时全表唯一：同一张送货单不能重复入仓。
    public string? 单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PurchaseReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 付款方式 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PurchaseReceiptDetailDto
{
    public PurchaseReceiptHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

// 来料标签查询·明细行：一条采购入仓明细(双击 单号 看整单)。无价格列。
public sealed class MaterialLabelDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 备品数量 { get; set; }   // 备品部分(不计订单欠数;实物入仓=数量+备品数量)
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

// 采购入仓查询·明细行：一条采购入仓明细(全列·无价格;双击 入库单号 看整单)。
// 入库单号=d.单号(采购入仓单号)，单号=d.条码号(来料/条码号)。
public sealed class PurchaseReceiptQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 备品数量 { get; set; }   // 备品部分(不计订单欠数;实物入仓=数量+备品数量)
    public string? 备注 { get; set; }
    public string? 备品 { get; set; }
    public string? 审核 { get; set; }
}

// 来料标签查询/采购入仓查询·汇总行：按 物料编号+规格+颜色 合并，数量=实物入仓合计(含备品)。
public sealed class MaterialLabelSummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
}

public sealed class AuxiliaryReceiptQuerySummaryRow
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 入仓数量 { get; set; }
}

public sealed class AuxiliaryReceiptQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 备品数量 { get; set; }   // 备品部分(不计订单欠数;实物入仓=数量+备品数量)
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
