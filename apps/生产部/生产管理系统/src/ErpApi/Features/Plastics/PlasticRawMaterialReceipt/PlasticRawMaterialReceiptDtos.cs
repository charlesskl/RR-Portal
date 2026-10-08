namespace ErpApi.Features.Plastics.PlasticRawMaterialReceipt;

public sealed class PlasticRawMaterialReceiptHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 单价类型 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialReceiptLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    // '1'=供应商多送的备品:允许超订单入库且不计入订单已入仓累计
    public string? 备品 { get; set; }
}

public sealed class PlasticRawMaterialReceiptDetailDto
{
    public PlasticRawMaterialReceiptHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialReceiptLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialReceiptCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
    // '1'=供应商多送的备品:允许超订单入库且不计入订单已入仓累计
    public string? 备品 { get; set; }
}

public sealed class PlasticRawMaterialReceiptCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialReceiptCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialReceiptQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 入库单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticRawMaterialReceiptQuerySummaryRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 金额 { get; set; }
}
