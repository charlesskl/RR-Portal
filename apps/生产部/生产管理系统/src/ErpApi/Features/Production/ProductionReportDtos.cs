namespace ErpApi.Features.Production;

// BOM物料查询：款号物料明细表 平铺行
public sealed class BomMaterialRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 使用数量 { get; set; }
}

// BOM货号查询：款号总表 + 物料项数 + 台头信息(日期/台头/审核/操作员,LEFT JOIN 款号物料台头,可空) + BOM明细
public sealed class BomStyleRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public decimal? 单价 { get; set; }
    public int 物料项数 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 台头 { get; set; }
    public string? 审核 { get; set; }
    public string? 操作员 { get; set; }
    public List<BomStyleDetailRow> 明细 { get; set; } = new();
}

// BOM货号查询明细行：款号物料明细表 物料编号/物料名称（打印「明细」行用）
public sealed class BomStyleDetailRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
}

// 货号接单汇总表：成品客户订单明细表 按货号归集
public sealed class OrderSummaryRow
{
    public string? 货号 { get; set; }
    public string? 款式 { get; set; }
    public decimal? 接单数量 { get; set; }
    public int 订单数 { get; set; }
}

// 采购超数查询：每(生产单 × 物料) 已采购数量 − BOM需求数量 > 0 的超采行
public sealed class PurchaseOverRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    public DateTime? 制单日期 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 已采购数量 { get; set; }
    public decimal? 超数 { get; set; }
}

// 领料超数/欠领查询：每(生产单 × 物料) 差异=已领数量 − BOM需求数量（负=欠领，正=超领）
public sealed class IssueOverRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    public DateTime? 制单日期 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 已领数量 { get; set; }
    public decimal? 差异 { get; set; }
}

// 制单用料查询：指定生产单 每物料 计划用量 对照 实际领料（差异=实际−计划，负=欠领/正=超领）
public sealed class OrderMaterialUsageRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 计划用量 { get; set; }
    public decimal? 实际领料 { get; set; }
    public decimal? 差异 { get; set; }
    public decimal? 预算单价 { get; set; }
    public decimal? 金额 { get; set; }
}

// 采购领料分析表：生产BOM物料清单 按(生产单号,物料编号)归集 + 审核采购入仓/审核领料 汇总（差异=需求−已领）
public sealed class PurchaseIssueAnalysisRow
{
    public DateTime? 制单日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 可用库存 { get; set; }
    public decimal? 需订数量 { get; set; }
    public decimal? 采购数量 { get; set; }
    public decimal? 已领数量 { get; set; }
    public decimal? 差异 { get; set; }
}

// 采购分析明细查询：生产BOM物料清单（算法4 缺料/需求 output）扁平明细行
public sealed class PurchaseAnalysisRow
{
    // ID 钉死大写:camelCase 策略会序列化成 id,前端 key/回写都用 ID(同 MA货号/PO号 先例)
    [System.Text.Json.Serialization.JsonPropertyName("ID")]
    public long ID { get; set; }                 // 生产BOM物料清单.ID(详情页修改回写键)
    public DateTime? 制单日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 总数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 可用库存 { get; set; }
    public decimal? 需订数量 { get; set; }
    public decimal? 预算单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    // 该生产单下此物料(含颜色)已累计下单数量(采购明细单 聚合,口径同 basis):>=需订=已下满,前端锁「已下单」
    public decimal? 已订数量 { get; set; }
}

// 采购分析明细保存(详情页):仅分析未审核可改;需订数量>=0;供应商编号空=解绑,非空校验存在
public sealed class PurchaseAnalysisSaveDto
{
    public string? 生产单号 { get; set; }
    public List<PurchaseAnalysisSaveLine> 明细 { get; set; } = [];
    // 绑定供应商时同步写 物料资料.默认供应商(日后新单自动带出,不用重复选);解绑不同步(不动主档)
    public bool 同步物料默认供应商 { get; set; }
}

public sealed class PurchaseAnalysisSaveLine
{
    public long ID { get; set; }
    public decimal? 需订数量 { get; set; }
    public string? 供应商编号 { get; set; }
}

// 物料订单制作工作表：生产BOM物料清单 需订数量>0 的待订物料行（勾选→按生产单×供应商生成采购订单）
public sealed class OrderWorksheetRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
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
}

// 成品余料统计表：按款号归集 成品入仓累计 − 成品出仓累计 = 余数（仅审核单，口径同成品库存算法1）
public sealed class FinishedLeftoverRow
{
    public string? 款号 { get; set; }
    public string? 客户 { get; set; }
    public string? 名称 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 出仓数量 { get; set; }
    public decimal? 余数 { get; set; }
}

// 合同余料统计表：按(合同号 × 物料) 采购入仓累计(审核) − BOM需求(生产BOM物料清单 Σ总数量) = 余料数量
public sealed class ContractLeftoverRow
{
    public string? 合同号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 采购数量 { get; set; }
    public decimal? 余料数量 { get; set; }
}

// 生产加工缺料表：每(生产单 × 物料) 缺料数量 = 需求 − 库存(可用库存) − 已领(审核领料)，仅列缺料行
public sealed class ProcessShortageRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 合同号 { get; set; }
    public DateTime? 制单日期 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 已领数量 { get; set; }
    public decimal? 缺料数量 { get; set; }
}

// 生产单跟踪表：生产制单 进度行（计划/裁床/录入/未完成数 + 审核完成状态）
public sealed class ProductionTrackingRow
{
    public string? 生产单号 { get; set; }
    public string? 标识 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 下单日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 裁床数量 { get; set; }
    public decimal? 录入数量 { get; set; }
    public decimal? 未完成数 { get; set; }
    public string? 装箱方式 { get; set; }
    public int? 订单总箱数 { get; set; }
    public string? 完成 { get; set; }
    public string? 审核 { get; set; }
    // 实单关联的MA单(生产制单货号.货号 → 款号物料总表.MA货号,取其一):非空=已关联MA,塑胶不能再下单
    public string? 关联MA货号 { get; set; }
}

// ==== BOM 层级树(bom-tree)====
// 关联数据源:款号物料总表.MA货号(实单→上级模板) + 半成品设置/明细(货号→半成品→组成)。
// 节点类型:BOM=款号物料总表行(含模板 MA 与实单);半成品=半成品设置定义;物料=组成叶级行。
public sealed class BomTreeResult
{
    public string? 货号 { get; set; }
    // 上级链:自顶向下(根模板 → … → 当前货号的上级),不含当前货号本身
    public List<BomTreeChainRow> 上级链 { get; set; } = [];
    public BomTreeNode? 树 { get; set; }
}

public sealed class BomTreeChainRow
{
    public string? 款号 { get; set; }
    public string? MA货号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class BomTreeNode
{
    public string 类型 { get; set; } = "BOM";   // BOM / 半成品 / 物料
    public string? 编号 { get; set; }            // BOM=款号;半成品=定义名称;物料=物料编号
    public string? 名称 { get; set; }            // BOM=款式;半成品=名称;物料=物料名称
    public string? 副标题 { get; set; }          // BOM=客户名称;物料=规格/颜色
    public decimal? 用量 { get; set; }           // 半成品=设置.用量;物料=组成使用数量
    public string? 审核 { get; set; }            // 仅 BOM 节点
    public int? 明细行数 { get; set; }           // 仅 BOM 节点(款号物料明细表行数)
    public List<BomTreeNode> 下级 { get; set; } = [];
}
