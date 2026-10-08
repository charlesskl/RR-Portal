namespace ErpApi.Features.Plastics.PlasticWhitePartIssue;

public sealed class PlasticWhitePartIssueHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public decimal? 胶箱数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 操作员 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 主管审核 { get; set; }        // 三级流转第一级：主管审核('1'=已审)
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }        // 三级流转第二级：经理审核
    public string? 经理审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueLineDto
{
    public long ID { get; set; }
    public string? 发外采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueDetailDto
{
    public PlasticWhitePartIssueHeaderDto? 单头 { get; set; }
    public List<PlasticWhitePartIssueLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticWhitePartIssueCreateLineDto
{
    public string? 发外采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public decimal? 胶箱数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticWhitePartIssueCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticWhitePartIssueBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
}
