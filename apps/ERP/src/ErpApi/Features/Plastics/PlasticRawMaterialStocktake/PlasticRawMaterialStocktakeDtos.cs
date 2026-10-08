namespace ErpApi.Features.Plastics.PlasticRawMaterialStocktake;

public sealed class PlasticRawMaterialStocktakeHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeDetailDto
{
    public PlasticRawMaterialStocktakeHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialStocktakeLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStocktakeCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeCreateDto
{
    public string? 电脑单号 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialStocktakeCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStocktakeQuerySummaryRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数 { get; set; }
    public decimal? 盘点数 { get; set; }
    public decimal? 盈亏数 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
