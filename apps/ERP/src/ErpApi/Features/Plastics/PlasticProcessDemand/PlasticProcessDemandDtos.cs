namespace ErpApi.Features.Plastics.PlasticProcessDemand;

// 塑胶仓加工件发外需求行(需发 = 需求量 − 白件库存 − 已发未回,下限 0)
public sealed class PlasticProcessDemandRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 加工次序 { get; set; }   // 第一次/第二次(单次加工为空)
    public string? 加工字母 { get; set; }   // BD/AF/AH 类别字母
    public decimal 需求量 { get; set; }     // 接单数量 × BOM 用量
    public decimal 白件库存 { get; set; }   // 塑胶台账聚合(塑胶入仓+/领料−/退料+/退仓−/报废−/盘点±)
    public decimal 已发未回 { get; set; }   // 已审核加工采购单订购 − 已审核塑胶入仓(按 生产单号+物料编号+颜色)
    public decimal 需发数量 { get; set; }
    // 塑胶物料资料.出模数(每啤几件):前端算啤数=⌈需发数量/出模数⌉;空/0 啤数留空
    public decimal? 出模数 { get; set; }
}

// 生成加工采购单入参行
public sealed class PlasticProcessDemandOrderLineDto
{
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 加工次序 { get; set; }
    public string? 加工字母 { get; set; }
    public decimal 数量 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public decimal? 单价 { get; set; }
}

public sealed class PlasticProcessDemandCreateRequest
{
    public string 生产单号 { get; set; } = "";
    public List<PlasticProcessDemandOrderLineDto> 行 { get; set; } = [];
}

public sealed class PlasticProcessDemandCreateResult
{
    public List<string> 单号列表 { get; set; } = [];
    public int 跳过 { get; set; }   // 已有同 生产单号+物料编号+加工内容 的加工采购明细(幂等防重)
}
