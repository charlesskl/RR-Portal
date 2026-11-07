namespace ErpApi.Features.Plastics;

public sealed class PlasticRawRecipeDto
{
    public string 原料编号 { get; set; } = "";
    public string? 原料名称 { get; set; }
    public List<PlasticRawRecipeLine> 明细 { get; set; } = [];
}

public sealed class PlasticRawRecipeLine
{
    public string 原料编号 { get; set; } = "";
    public string? 原料名称 { get; set; }
    public decimal 比例 { get; set; }
    public string 库存单位 { get; set; } = "KG";
    public decimal 每库存单位KG { get; set; } = 1;
}

public sealed class PlasticRawConsumptionSnapshot
{
    public long 采购明细ID { get; set; }
    public long 原料ID { get; set; }
    public string 原料编号 { get; set; } = "";
    public string 原料名称 { get; set; } = "";
    public decimal 比例 { get; set; }
    public decimal 总比例 { get; set; }
    public decimal 用量KG { get; set; }
    public decimal 库存数量 { get; set; }
    public string 库存单位 { get; set; } = "KG";
    public decimal 每库存单位KG { get; set; }
    public decimal? 库存KG { get; set; }
}

public sealed class PlasticRawPreviewRequest
{
    public string? 加工类型 { get; set; }
    public string? 加工内容 { get; set; }
    public List<PlasticRawPreviewLineRequest> 明细 { get; set; } = [];
}

public sealed class PlasticRawPreviewLineRequest
{
    public string 物料编号 { get; set; } = "";
    public decimal 数量 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 颜色 { get; set; }
    public decimal? 套数 { get; set; }
    public string? 打印模具名称 { get; set; }
    public string? 来源补料单号 { get; set; }
    public long? 来源补料明细ID { get; set; }
}

public sealed class PlasticRawPreviewLine
{
    public string 物料编号 { get; set; } = "";
    public decimal? 单件克重 { get; set; }
    public List<PlasticRawConsumptionSnapshot> 原料组成 { get; set; } = [];
    public string? 原料配比错误 { get; set; }
    public int? 原料核算版本 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 原料用量KG { get; set; }
    public int? 原料组号 { get; set; }
    public bool? 原料组主行 { get; set; }
    public int? 原料组成员数 { get; set; }
    public decimal? 核算套数 { get; set; }
    public decimal? 核算出模数 { get; set; }
    public decimal? 啤货订单数量 { get; set; }
    public decimal? 啤货总用量 { get; set; }
    public int? 啤货颜色数 { get; set; }
    public string? 啤货公式说明 { get; set; }
    public string? 啤货用量文本 { get; set; }
    public decimal? 核算整啤净重 { get; set; }
    public decimal? 核算啤数 { get; set; }
    public string? 核算模具编号 { get; set; }
    public string? 核算模具名称 { get; set; }
    public decimal? 原料组净重KG { get; set; }
}
