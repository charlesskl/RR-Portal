namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

public sealed class PlasticRawMaterialDemandHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 制单人 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 操作员 { get; set; }
    public decimal? 数量KG { get; set; }
    public decimal? 数量包 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 需求数量KG { get; set; }
    public decimal 需求数量包 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandDetailDto
{
    public PlasticRawMaterialDemandHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialDemandLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialDemandSummaryRow
{
    public string 单号 { get; set; } = "";
    public DateTime? 开单日期 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 需求数量KG { get; set; }
    public decimal 需求数量包 { get; set; }
    public string? 备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticRawMaterialDemandCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 需求数量KG { get; set; }
    public decimal 需求数量包 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandCreateDto
{
    public string? 啤机生产单号 { get; set; }
    public string? 制单人 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialDemandCreateLineDto> 明细 { get; set; } = new();
}
