using System.Text.Json.Serialization;
namespace ErpApi.Features.Materials.PurchaseOrder;

// 采购物料单/采购订单：两层(采购订单 单头 + 采购明细单 明细)，自由开单或从生产单BOM带料生成。

public sealed class PurchaseOrderLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }      // 本次已订数量
    public decimal? 单价 { get; set; }
    public decimal? 预算数量 { get; set; }
    public string? 生产单号 { get; set; }  // 行级(自由开单可逐行不同;空则回落单头)
    public string? 款号 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PurchaseOrderCreateDto
{
    public string? 生产单号 { get; set; }   // 自由开单可空
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 日期 { get; set; }     // 可空,空则取当天
    public DateTime? 交货日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    [JsonPropertyName("PO号")]   // 大写 PO 开头,camelCase 策略会错拼成 pO号,钉死原名
    public string? PO号 { get; set; }       // 客户 PO号(排期下单自动带入)
    public string? 收件人 { get; set; }
    public string? 备注 { get; set; }
    public List<PurchaseOrderLineDto> 明细 { get; set; } = [];
}

public sealed class PurchaseOrderHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    public string? 生产单号 { get; set; }
    [JsonPropertyName("PO号")]   // 同上:钉死序列化名,避免 pO号
    public string? PO号 { get; set; }
    public string? 收件人 { get; set; }
    public int? 打印次数 { get; set; }
    // 三级流转:主管审核 → 经理审核 → 审核(下发,审核='1')
    public string? 主管审核 { get; set; }
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }
    public string? 经理审核人 { get; set; }
    // 供应商资料带出(仅 GetAsync 详情,打印用)
    public string? 供应商联系人 { get; set; }
    public string? 供应商电话 { get; set; }
    public string? 供应商传真 { get; set; }
    public string? 供应商货币 { get; set; }
    public string? 供应商付款方式 { get; set; }
}

public sealed class PurchaseOrderLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public decimal? 预算数量 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 备注 { get; set; }
    // 行级供应商(下单时=单头供应商,随明细落库;前端「默认供应商」列重开已存单时显示用)
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    // 实时可用库存(库存引擎聚合,仅 GetAsync 详情填充;与 basis/采购分析同口径)
    public decimal? 可用库存 { get; set; }
}

public sealed class PurchaseOrderDetailDto
{
    public PurchaseOrderHeaderDto? 单头 { get; set; }
    public List<PurchaseOrderLineRowDto> 明细 { get; set; } = [];
}

// BasisAsync：从 生产BOM物料清单 带出的采购基准行(物料类别取物料资料;合同号=生产制单.合同号)。
public sealed class PurchaseOrderBasisRow
{
    // ID 钉死大写(camelCase 会变成 id,前端按 ID 对齐分析页勾选行)
    [System.Text.Json.Serialization.JsonPropertyName("ID")]
    public long ID { get; set; }   // 生产BOM物料清单.ID(分析页勾选行随 URL 带入时按它对齐)
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 总数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 可用库存 { get; set; }
    public decimal? 需订数量 { get; set; }
    public decimal? 预算单价 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 合同号 { get; set; }
    // 该生产单下此物料(含颜色匹配)已累计下单的数量，>0 即"已下单"（防重复下单）
    public decimal? 已订数量 { get; set; }
    // 采购物料设置.采购损耗率(%):前端默认下单数量=需订×(1+损耗率/100)向上取整;空=0 不加成
    public decimal? 采购损耗率 { get; set; }
}

// 订单进度行：一条采购订单明细 + 入仓进度（订购/入仓/欠数）
public sealed class PurchaseOrderProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 备注 { get; set; }
}

// 进度明细行：一条订单明细 × 一次已审核入仓（未入仓则入仓列为 null）
public sealed class PurchaseOrderProgressDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public string? 入仓单号 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 备品 { get; set; }   // '1'=该条入仓是供应商备品(不占订单欠数)
    public string? 供应商名称 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
}

// 订购单查询·明细行：一条采购明细单(双击 单号 看整单)。价格按权限脱敏。
public sealed class PurchaseOrderQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
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
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
    public string? 备注 { get; set; }
}

// 订购单查询·汇总行：按 物料编号+规格+颜色 合并，SUM(数量)=订购数量。无价格列。
public sealed class PurchaseOrderQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
}

public sealed class AuxiliaryOrderReceiptStatRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 订购单号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 采购单价 { get; set; }
    public decimal? 单价HKD { get; set; }
    public decimal? 其他成本单价HKD { get; set; }
    public decimal 订货数量 { get; set; }
    public decimal 订货金额HKD { get; set; }
    public decimal 入库数量 { get; set; }
    public decimal 入库订货金额HKD { get; set; }
    public decimal 入库其他费用HKD { get; set; }
    public decimal 入库金额合计HKD { get; set; }
    public decimal 相关数量 { get; set; }
    public decimal 相关金额HKD { get; set; }
    public string? 操作员 { get; set; }
}

public sealed class AuxiliaryProgressDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 订购单号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 单价类型 { get; set; }
    public decimal? 订货数量 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 总入仓数 { get; set; }
    public decimal? 相差数量 { get; set; }
}

public sealed class AuxiliaryPurchaseOrderQuerySummaryRow
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订货数量 { get; set; }
}

public sealed class AuxiliaryPurchaseOrderQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
