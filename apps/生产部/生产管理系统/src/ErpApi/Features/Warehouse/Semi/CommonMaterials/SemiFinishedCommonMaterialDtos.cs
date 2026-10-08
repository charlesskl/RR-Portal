namespace ErpApi.Features.Warehouse.Semi.CommonMaterials;

public sealed class SemiFinishedCommonMaterialQuery
{
    public string? 重复内容 { get; set; }
    public string? 待操作物料 { get; set; }
    public string? 审核情况 { get; set; }
    public string? 查询字段 { get; set; }
    public string? Keyword { get; set; }
    public bool 精确 { get; set; }
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
}

public sealed class SemiFinishedCommonMaterialRow
{
    public string 产品货号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 库存单价 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 共用物料编号 { get; set; }
    public string 调整审核 { get; set; } = "未审核";
    public string? 备注内容 { get; set; }
}
