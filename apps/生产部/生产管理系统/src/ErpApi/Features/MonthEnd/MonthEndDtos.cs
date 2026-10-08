namespace ErpApi.Features.MonthEnd;

// 月报/快照行：成品填款号维度、半成品填物料维度，另一组留 null。数量列均 decimal。
public sealed class MonthEndRow
{
    public string? 年月 { get; set; }
    public string? 仓库 { get; set; }
    public string? 口径 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal 期初 { get; set; }
    public decimal 本期入 { get; set; }
    public decimal 本期出 { get; set; }
    public decimal 结存 { get; set; }
    public decimal? 期初金额 { get; set; }
    public decimal? 本期入金额 { get; set; }
    public decimal? 本期出金额 { get; set; }
    public decimal? 结存金额 { get; set; }
    public decimal? 加权单价 { get; set; }
}

public sealed class MonthEndCloseRequest
{ public string 年月 { get; set; } = ""; public string 口径 { get; set; } = ""; public string? 仓库 { get; set; } }

public sealed class MonthEndReopenRequest
{ public string 年月 { get; set; } = ""; public string 口径 { get; set; } = ""; public string? 仓库 { get; set; } }

public sealed class MonthEndCloseResult
{ public int 结数 { get; set; } public IReadOnlyList<string> 仓库 { get; set; } = []; }
