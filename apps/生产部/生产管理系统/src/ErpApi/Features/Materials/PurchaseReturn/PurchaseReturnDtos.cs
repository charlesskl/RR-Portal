using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.PurchaseReturn;

public sealed class PurchaseReturnCreateDto
{
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PurchaseReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PurchaseReturnDetailDto
{
    public PurchaseReturnHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

// 采购退仓单查询·明细行：一条采购退仓明细(无价格;双击 单号 看整单)。
public sealed class PurchaseReturnQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
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

// 采购退仓单查询·汇总行：按 物料编号+规格+颜色 合并，SUM(数量)=退仓数量。
public sealed class PurchaseReturnSummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 退仓数量 { get; set; }
}
