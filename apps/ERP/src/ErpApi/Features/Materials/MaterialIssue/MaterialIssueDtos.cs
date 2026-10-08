using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.MaterialIssue;

public sealed class MaterialIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? 接受人 { get; set; }   // 仓管/PMC(职称),经理审核完后消息只发给该接受人
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 主管审核 { get; set; }        // 三级流转第一级：部门主管审核('1'=已审)
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }        // 三级流转第二级：部门经理审核
    public string? 经理审核人 { get; set; }
    public string? 接受人 { get; set; }          // 开单选定的仓管/PMC,经理审完后接收该单
    public string? 备注 { get; set; }
}


public sealed class MaterialIssueDetailDto
{
    public MaterialIssueHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

// 分次出库提交行：行ID=领料明细单.ID，数量=本次出库数量(≤ 申请数量−已出数量)
public sealed class MaterialIssueOutboundLineDto
{
    public long 行ID { get; set; }
    public decimal 数量 { get; set; }
}

public sealed class MaterialIssueOutboundDto
{
    public List<MaterialIssueOutboundLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialIssueOutboundResult
{
    public string? 单号 { get; set; }
    public int 出库行数 { get; set; }
    public bool 完成 { get; set; }   // true=全部行已出完(自动置审核='1')
}

// 领料单查询·明细行：一条领料明细(无价格;双击 单号 看整单)。
public sealed class MaterialIssueQueryDetailRow
{
    public string? 类型 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
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

// 领料单查询·汇总行：按 物料编号+规格+颜色 合并，SUM(数量)=领用数量。
public sealed class MaterialIssueSummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 领用数量 { get; set; }
}

public sealed class AuxiliaryIssueDetailRow
{
    public DateTime? 开单日期 { get; set; }
    public string? 装配生产单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public DateTime? 领料日期 { get; set; }
    public string? 领料单号 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 合计已领数量 { get; set; }
    public decimal? 未领数量 { get; set; }
}

public sealed class AuxiliaryStockIssueQuerySummaryRow
{
    public string? 领料备注 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 装配生产单号 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 领料数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AuxiliaryStockIssueQueryDetailRow
{
    public string? 领料备注 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 装配生产单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 领料人 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 审核 { get; set; }
}
