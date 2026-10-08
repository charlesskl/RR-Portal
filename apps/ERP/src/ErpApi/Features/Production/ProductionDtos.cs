using System.Text.Json.Serialization;

namespace ErpApi.Features.Production;

// 一行颜色×尺码数量
public sealed class ProductionQtyDto
{
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 一个货号行（对应一个 BOM款号），承载该货号的色×码数量
public sealed class ProductionGoodsLineDto
{
    public string 货号 { get; set; } = "";
    public string BOM款号 { get; set; } = "";
    public string? 款号名称 { get; set; }
    public decimal? 比例 { get; set; }
    public bool 分析 { get; set; } = true;
    public List<ProductionQtyDto> 数量明细 { get; set; } = [];   // 颜色/尺码/数量
}

// 新建生产通知单（一单多货号；可从订单生成：传 订单单号 则回写关联）
public sealed class ProductionNoticeCreateDto
{
    public string? 订单类型 { get; set; }
    public string? 标识 { get; set; }
    public string? 装箱方式 { get; set; }
    public int? 订单总箱数 { get; set; }
    public string? 默认单价 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 跟单员 { get; set; }
    public DateTime? 下单日期 { get; set; }
    public string? 备注 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 生产单号 { get; set; }   // 可手动指定(留空自动生成)
    public decimal? 接单数量 { get; set; }  // 可手动输入;留空回落为明细合计(计划数量)
    public List<ProductionGoodsLineDto> 货号明细 { get; set; } = [];
}


// 领料应领行:生产单 BOM 展开快照(生产BOM物料清单)按物料聚合 应领=Σ总数量;档=来料/塑胶 按档案过滤
// 档=半成品/成品 时改为返回该生产单在 半成品仓/成品仓 的现存净额(成品行 物料编号=款号、单位=个)
// 货号:BOM 快照的货号值;按货号=true 时来料/塑胶档按 生产单号+货号+物料编号 分组(批量领料挑选用),
//   默认(false)仍按物料聚合,货号=MAX(同 款号 字段),不影响老调用方
public sealed class IssueBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
}

// 列表行（单头）
public sealed class ProductionHeaderDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public DateTime? 下单日期 { get; set; }
    public decimal? 接单数量 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 订单类型 { get; set; }
    public string? 标识 { get; set; }
    public string? 装箱方式 { get; set; }
    public int? 订单总箱数 { get; set; }
    public string? 默认单价 { get; set; }
    public string? 制单人 { get; set; }
    public string? 跟单员 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 工序数 { get; set; }
    public decimal? 工序单价 { get; set; }
    public decimal? 物料金额 { get; set; }
    public decimal? 出货单价 { get; set; }
    public decimal? 入半成品数量 { get; set; }   // 已审核半成品入仓合计(按生产单号)
    public decimal? 入成品数量 { get; set; }     // 已审核成品入仓合计(按生产单号)
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    // 采购分析审核(采购物料分析独立审核层,≠ 本单审核):'1'=已审核;采购物料分析页列表/下单门用
    public string? 采购分析审核 { get; set; }
    public string? 采购分析审核人 { get; set; }
    public DateTime? 采购分析审核时间 { get; set; }
    public string? 完成 { get; set; }
    public string? 反审核申请 { get; set; }       // '1'=有待经理批准的反审核申请
    public string? 反审核申请人 { get; set; }
    public string? 反审核申请原因 { get; set; }
    public string? 备注 { get; set; }
}

// 反审核申请（申请-审批流：操作员申请 → 经理消息中心批准 → 一步到位回未审核）
// 含BOM=true=整步（批准时带出绑定BOM一并反审核）；false=单个（仅生产单）
public sealed class UnapproveRequestDto
{
    public string? 原因 { get; set; }
    public bool 含BOM { get; set; }
}

// 查询生产单顶部合计(与 ListAsync 同关键字过滤,不分页汇总全部匹配行)
public sealed class ProductionSummaryDto
{
    public decimal 计划数量合计 { get; set; }
    public decimal 入半成品数量合计 { get; set; }
    public decimal 入成品数量合计 { get; set; }
}

// 货号明细行（生产制单货号；GetAsync 返回）
public sealed class ProductionGoodsRowDto
{
    public long ID { get; set; }
    public int? 序号 { get; set; }
    public string? 货号 { get; set; }
    // STJ camelCase 会把 BOM款号 序列化成 boM款号，前端读 BOM款号，这里固定输出名
    [JsonPropertyName("BOM款号")]
    public string? BOM款号 { get; set; }
    public string? 款号名称 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 比例 { get; set; }
    public bool? 分析 { get; set; }
}

// 工序行（算法3 展开结果）
public sealed class ProductionProcessDto
{
    public long ID { get; set; }
    public string? 货号 { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 工序类型 { get; set; }
}

// 数量行（规范化色×码）
public sealed class ProductionQtyRowDto
{
    public long ID { get; set; }
    public string? 货号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
}

// BOM 行（算法4 展开结果，Task 7 用）
public sealed class ProductionBomDto
{
    public long ID { get; set; }
    public string? 货号 { get; set; }
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
}

// 详情 = 单头 + 货号明细 + 数量 + 工序 + BOM
public sealed class ProductionDetailDto
{
    public ProductionHeaderDto? 单头 { get; set; }
    public List<ProductionGoodsRowDto> 货号明细 { get; set; } = [];
    public List<ProductionQtyRowDto> 数量 { get; set; } = [];
    public List<ProductionProcessDto> 工序 { get; set; } = [];
    public List<ProductionBomDto> 物料 { get; set; } = [];
    // 半成品需求(展示用,不进 生产BOM物料清单):实单版 BOM 的半成品行 用量×货号数量;
    // 半成品由半成品仓/装配领料,不参与采购——写入快照会污染采购分析/物料订单工作表,故只在详情实时带出
    public List<ProductionSemiNeedDto> 半成品需求 { get; set; } = [];
}

// 半成品需求行(生产单详情;实单版 BOM 的半成品行 × 货号数量)
public sealed class ProductionSemiNeedDto
{
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 总数量 { get; set; }
}

// MO单跟踪行（生产通知单MO单；MO单录入页签）。ID 为 IDENTITY，保存时不传。
public sealed class MoLineDto
{
    public int? 序号 { get; set; }
    public DateTime? 接单日期 { get; set; }
    public string? 正单合同号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public decimal? 接单数量 { get; set; }
    public string? 装箱方式 { get; set; }
    public int? 订单总箱数 { get; set; }
    public DateTime? 验货日期 { get; set; }
    public string? 备注 { get; set; }
}

// BOM 展开的内部数据源行（款号物料明细表 LEFT JOIN 物料资料/供应商资料，Task 7 用）
public sealed class BomSourceRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 使用数量 { get; set; }
    public decimal? 预算单价 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
}
