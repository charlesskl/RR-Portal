namespace ErpApi.Features.Production.Piecework;

// 一条计件：某工人做某工序若干件
public sealed class PieceworkLineDto
{
    public string 工序号 { get; set; } = "";
    public string 员工号 { get; set; } = "";
    public string? 货号 { get; set; }   // 该计件所属货号(一单多货号);单价按 生产单号+货号+工序号 取，消歧义
    public decimal 数量 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public int? 扎号 { get; set; }
}

// 批量录入（一次提交多条计件，共享生产单/裁床单上下文）
public sealed class PieceworkRecordDto
{
    public string 生产单号 { get; set; } = "";
    public string? 裁床单号 { get; set; }
    public string? 床号 { get; set; }
    public DateTime? 裁床日期 { get; set; }
    public List<PieceworkLineDto> 明细 { get; set; } = [];
}

// 查询行（读出，含工序名称/姓名）
public sealed class PieceworkRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 裁床单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public string? 员工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public int? 扎号 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

// 计件汇总行（按 员工×工序 归集；算法2 前身）
public sealed class PieceworkSummaryRow
{
    public string? 员工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
