namespace SprayPlan.Api.Entities;

// 部位 product_parts：4 价（核/人工/油漆/报价）+ 产能字段（Phase A 新增）。
public class ProductPart
{
    public int Id { get; set; }
    public int ItemId { get; set; }
    public string PartName { get; set; } = "";
    public int PartOrder { get; set; }
    public double UnitCost { get; set; }       // 核价
    public double LaborPrice { get; set; }     // 人工价
    public double PaintCost { get; set; }      // 油漆价
    public double QuotedPrice { get; set; }    // 报价
    public string Craft { get; set; } = "";    // 工序/工艺：手喷 / 移印 / 自动喷 / UV（部位级·大类·排期分拉别）
    public string CraftDetail { get; set; } = ""; // 工序细类：原始小类（喷油/散枪/PP水…），导入时原样保留，不丢信息
    public int DailyCapacity { get; set; }     // 单台/单人日产能
    public string ProductionMode { get; set; } = "machine";  // machine 机喷 / manual 人工喷
    public int StdMachineCount { get; set; } = 1;            // 标准投入台/人数
    public bool IsTumbler { get; set; }         // 是否走炒货机：true→归手喷拉 + 产能无限桶
    public int CraftPasses { get; set; }        // 工序道数：该部位走几道工序（存 partOrder 最小那行）；约束 ≥ 工序种类数
    public string? Remark { get; set; }

    public ProductItem? Item { get; set; }
}
