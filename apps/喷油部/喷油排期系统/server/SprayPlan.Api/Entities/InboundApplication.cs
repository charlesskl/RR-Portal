namespace SprayPlan.Api.Entities;

// 成品入库申请单。实际入库数每次发生变化时自动生成一张，ERP 只读拉取。
public class InboundApplication
{
    public int Id { get; set; }
    public string ApplicationNo { get; set; } = "";
    public int SourcePlanId { get; set; }
    public string FactoryId { get; set; } = "XINGXIN";
    public DateTime ProductionDate { get; set; }
    public string OrderNo { get; set; } = "";
    public string ProductNo { get; set; } = "";
    public string ItemName { get; set; } = "";
    public string PartName { get; set; } = "";
    public int Quantity { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    // 编辑留痕：updatedAt 初始等于 createdAt，编辑后刷新；
    // ERP 增量拉取以 updatedAt 为准——编辑过的单会重新出现在增量里（即"重新发送给 ERP"）。
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public string? Remark { get; set; }
}
