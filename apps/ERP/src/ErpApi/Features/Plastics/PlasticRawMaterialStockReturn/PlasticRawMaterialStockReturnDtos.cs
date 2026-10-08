namespace ErpApi.Features.Plastics.PlasticRawMaterialStockReturn;

public sealed class PlasticRawMaterialStockReturnHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 部门 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 退料人 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 操作员 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockReturnLineDto
{
    public long ID { get; set; }
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockReturnDetailDto
{
    public PlasticRawMaterialStockReturnHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialStockReturnLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStockReturnCreateLineDto
{
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockReturnCreateDto
{
    public string? 部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialStockReturnCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStockReturnQuerySummaryRow
{
    public string? 啤机生产单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 退料数量 { get; set; }
}

public sealed class PlasticRawMaterialStockReturnQueryDetailRow
{
    public string? 啤机生产单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
