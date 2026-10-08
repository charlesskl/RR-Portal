namespace ErpApi.Features.Plastics.PlasticStocktake;

public sealed class PlasticStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public decimal 系统数量 { get; set; }
}

public sealed class PlasticStocktakeLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}

public sealed class PlasticStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<PlasticStocktakeLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}

public sealed class PlasticStocktakeDetailDto
{
    public PlasticStocktakeHeaderDto? 单头 { get; set; }
    public List<PlasticStocktakeLineRowDto> 明细 { get; set; } = [];
}

public sealed class PlasticStocktakeQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticStocktakeQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
