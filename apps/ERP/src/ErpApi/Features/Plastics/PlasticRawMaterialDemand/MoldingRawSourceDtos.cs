namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

// 自动需求只是读取已保存的啤机采购快照，不复制成新的手工 YLX 单据。
public sealed class MoldingRawSourceHeader
{
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 审核 { get; set; }
    public int? 原料扣减版本 { get; set; }
    public decimal 需求数量KG { get; set; }
    public int 原料种数 { get; set; }
    public bool 可采购 { get; set; }
    public bool 快照有效 { get; set; }
    public string? 限制原因 { get; set; }
}

public sealed class MoldingRawSourceLine
{
    public string 原料编号 { get; set; } = "";
    public string 原料名称 { get; set; } = "";
    public decimal 需求数量KG { get; set; }
    public string 库存单位 { get; set; } = "";
    public decimal 每库存单位KG { get; set; }
    public decimal 需求库存数量 { get; set; }
}

public sealed class MoldingRawSourceDetail
{
    public MoldingRawSourceHeader 单头 { get; set; } = new();
    public List<MoldingRawSourceLine> 明细 { get; set; } = [];
}
