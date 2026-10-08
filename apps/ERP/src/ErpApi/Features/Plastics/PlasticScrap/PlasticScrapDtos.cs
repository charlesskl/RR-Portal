namespace ErpApi.Features.Plastics.PlasticScrap;

public sealed class PlasticScrapHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
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
}

public sealed class PlasticScrapLineDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
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
}

public sealed class PlasticScrapDetailDto
{
    public PlasticScrapHeaderDto? 单头 { get; set; }
    public List<PlasticScrapLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticScrapCreateLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
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
}

public sealed class PlasticScrapCreateDto
{
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public List<PlasticScrapCreateLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticScrapQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticScrapQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
