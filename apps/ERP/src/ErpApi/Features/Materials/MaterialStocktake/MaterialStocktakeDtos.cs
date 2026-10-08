namespace ErpApi.Features.Materials.MaterialStocktake;

public sealed class MaterialStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
}

public sealed class MaterialStocktakeLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}

public sealed class MaterialStocktakeCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<MaterialStocktakeLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialStocktakeHeaderDto
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

public sealed class MaterialStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}

public sealed class MaterialStocktakeDetailDto
{
    public MaterialStocktakeHeaderDto? 单头 { get; set; }
    public List<MaterialStocktakeLineRowDto> 明细 { get; set; } = [];
}

// 盘点单查询·明细行：一条盘点明细(颜色/材料/单价来自物料资料 JOIN;金额=盈亏数×单价;价格按"单价"权限脱敏;双击 单号 看整单)。
public sealed class MaterialStocktakeQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

// 盘点单查询·汇总行：按 物料编号+规格+颜色 合并；系统/盘点/盈亏数=SUM；金额=SUM(盈亏数)×单价(价格按"单价"权限脱敏)。
public sealed class MaterialStocktakeSummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
