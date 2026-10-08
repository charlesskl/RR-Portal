namespace ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;

public sealed class PlasticProcessPurchaseOrderHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 收货人 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    // 三级流转:主管审核 → 经理审核 → 审核(下发,审核='1')
    public string? 主管审核 { get; set; }
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }
    public string? 经理审核人 { get; set; }
}

public sealed class PlasticProcessPurchaseOrderLineDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 加工次序 { get; set; }   // 二次加工: 第一次/第二次
    public string? 加工字母 { get; set; }   // 二次加工类别字母(B/D/A/F/H)
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticProcessPurchaseOrderDetailDto
{
    public PlasticProcessPurchaseOrderHeaderDto? 单头 { get; set; }
    public List<PlasticProcessPurchaseOrderLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticProcessPurchaseOrderCreateLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 加工次序 { get; set; }
    public string? 加工字母 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticProcessPurchaseOrderCreateDto
{
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 收货人 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticProcessPurchaseOrderCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticProcessPurchaseOrderBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 二次加工内容 { get; set; }
    public string? 二次加工类别 { get; set; }  // BD/AF/AH,由 加工内容+二次加工内容 推导
    public decimal? 单价 { get; set; }
}

public sealed class PlasticProcessPurchaseQueryDetailRow
{
    public DateTime? 单据日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticProcessPurchaseQuerySummaryRow
{
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 总金额 { get; set; }
}

public sealed class PlasticProcessPurchaseProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 加工采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 订购金额 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 入仓金额 { get; set; }
    public decimal? 剩余数量 { get; set; }
    public decimal? 剩余金额 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticProcessPurchaseDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 订购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 订购金额 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 入仓金额 { get; set; }
    public decimal? 未完成数量 { get; set; }
    public decimal? 未完成金额 { get; set; }
    public string? 完成情况 { get; set; }
    public string? 加工厂名称 { get; set; }
}

public sealed class PlasticProcessIssueProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 订购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 订购金额 { get; set; }
    public DateTime? 领料日期 { get; set; }
    public string? 领料单号 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 未完成数量 { get; set; }
    public decimal? 未完成金额 { get; set; }
    public string? 完成情况 { get; set; }
    public string? 加工厂名称 { get; set; }
}

public sealed class PlasticProcessShortageRow
{
    public string? 物料编号 { get; set; }
    public string? 共用物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
