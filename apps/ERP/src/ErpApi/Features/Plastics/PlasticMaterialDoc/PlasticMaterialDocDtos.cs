namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

// 塑胶采购分析·生产单行
public sealed class PlasticOrderRow
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal? 计划数量 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 审核 { get; set; }
    // 已保存=存在引用该生产单的塑胶采购订单明细(单未删即算,含未审核;删除采购单后回到未保存)
    public bool 已下单 { get; set; }
    public string? 采购单号 { get; set; }   // 逗号分隔去重(已保存分组用)
}

// 塑胶物料单·带出基准行(从塑胶共用物料表 JOIN 生产制单货号;仓位号来自塑胶物料资料)
public sealed class PlasticMaterialBasisRow
{
    public string? 货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
}

public sealed class PlasticMaterialDocHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 客户 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticMaterialDocLineDto
{
    public long ID { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticMaterialDocDetailDto
{
    public PlasticMaterialDocHeaderDto? 单头 { get; set; }
    public List<PlasticMaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticMaterialDocCreateLineDto
{
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal 订购数量 { get; set; }
}

public sealed class PlasticMaterialDocCreateDto
{
    public string? 生产单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 客户 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticMaterialDocCreateLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticCustomerTypeStatRow
{
    public string? 客户 { get; set; }
    public string? 类型 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class PlasticAnalysisDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 单位 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 完成 { get; set; }
}

public sealed class PlasticOrderQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticOrderQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class PlasticLabelQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticLabelQuerySummaryRow
{
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
}

public sealed class PlasticProcessOrderMakeRow
{
    public DateTime? 单据日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 二次加工内容 { get; set; }
    public string? 二次加工类别 { get; set; }  // BD/AF/AH
    public string? 加工次序 { get; set; }      // 二次加工行拆为 第一次/第二次 两条
    public string? 加工字母 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
}

// 已下喷油订单行(喷油部收件视图):已审核塑胶采购订单中 供应商名称含「喷油」的单,按明细行展开
public sealed class SprayOrderReceivedRow
{
    public string? 采购单号 { get; set; }
    public DateTime? 单据日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 塑胶货号 { get; set; }      // 按物料编号从 BOM 补
    public string? 加工内容 { get; set; }      // 塑胶物料资料优先,BOM 回落
    public string? 喷油接收 { get; set; }      // '1'=喷油部已接收
    public string? 喷油接收人 { get; set; }
    public DateTime? 喷油接收时间 { get; set; }
}
