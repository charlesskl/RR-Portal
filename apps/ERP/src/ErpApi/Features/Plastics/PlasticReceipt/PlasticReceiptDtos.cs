namespace ErpApi.Features.Plastics.PlasticReceipt;

public sealed class PlasticReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
}

public sealed class PlasticReceiptLineDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 订单单号 { get; set; }
    // 已加工工序快照：入仓时从来源塑胶采购订单带出(明细加工内容 回落 单头加工内容)
    public string? 加工内容 { get; set; }
    // '1'=供应商多送的备品:允许超订单入库且不计入订单已入仓累计
    public string? 备品 { get; set; }
}

public sealed class PlasticReceiptDetailDto
{
    public PlasticReceiptHeaderDto? 单头 { get; set; }
    public List<PlasticReceiptLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReceiptCreateLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
    public string? 订单单号 { get; set; }
    // '1'=供应商多送的备品:允许超订单入库且不计入订单已入仓累计
    public string? 备品 { get; set; }
}

public sealed class PlasticReceiptCreateDto
{
    // 入仓单号=供应商送货单号（手填）；留空则按 RJ+日期+流水 自动生成（兼容旧流程）。
    // 手填时全表唯一：同一张送货单不能重复入仓。
    public string? 单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
    public List<PlasticReceiptCreateLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReceiptQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 供应商 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticReceiptQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
