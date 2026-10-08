namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

public sealed class PlasticRawMaterialStockIssueHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 生产车间 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 操作员 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 主管审核 { get; set; }        // 三级流转第一级：主管审核('1'=已审)
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }        // 三级流转第二级：经理审核
    public string? 经理审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueLineDto
{
    public long ID { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 生产单号 { get; set; }   // 联动生产制单.生产单号(与啤机生产单号并存,语义不同)
    public DateTime? 开单日期 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueDetailDto
{
    public PlasticRawMaterialStockIssueHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialStockIssueLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStockIssueCreateLineDto
{
    public string? 啤机生产单号 { get; set; }
    public string? 生产单号 { get; set; }   // 联动生产制单.生产单号
    public DateTime? 开单日期 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueCreateDto
{
    public string? 生产车间 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialStockIssueCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialIssueProgressRow
{
    public DateTime? 开单日期 { get; set; }
    public string? 需求单号 { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 已出库数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 进度 { get; set; }   // 已出库数量/需求数量×100(%);需求为 0 时留空
    public DateTime? 最后出库日期 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticRawMaterialIssueProgressDetailRow
{
    public DateTime? 开单日期 { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public DateTime? 领料日期 { get; set; }
    public string? 领料单号 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 合计已领数量 { get; set; }
    public decimal? 未领数量 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticRawMaterialOutsourceShortageRow
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 供应商类别 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 发外欠数 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueQuerySummaryRow
{
    public string? 领料备注 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 领料数量包 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueQueryDetailRow
{
    public string? 领料备注 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 啤机生产单号 { get; set; }
    public string? 生产单号 { get; set; }   // 联动生产制单.生产单号
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量包 { get; set; }
    public string? 备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 审核 { get; set; }
}
