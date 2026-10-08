using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.MaterialReturn;

public sealed class MaterialReturnCreateDto
{
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class MaterialReturnDetailDto
{
    public MaterialReturnHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

// 退料单查询·明细行：一条退料明细(无价格;双击 单号 看整单)。
public sealed class MaterialReturnQueryDetailRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

// 退料单查询·汇总行：按 生产单号+物料编号+规格+颜色 合并(原系统"按生产单号")，SUM(数量)=退料数量。
public sealed class MaterialReturnSummaryRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 退料数量 { get; set; }
}

public sealed class AuxiliaryStockReturnQuerySummaryRow
{
    public string? 装配生产单号 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 退料数量 { get; set; }
}

public sealed class AuxiliaryStockReturnQueryDetailRow
{
    public string? 装配生产单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
