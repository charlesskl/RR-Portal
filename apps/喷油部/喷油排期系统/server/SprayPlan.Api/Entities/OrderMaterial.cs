namespace SprayPlan.Api.Entities;

// 原料就绪快照。独立于成品库存，后续 ERP 可通过同一业务接口提供快照。
public class OrderMaterial
{
    public int Id { get; set; }
    public string FactoryId { get; set; } = "XINGXIN";
    public int OrderId { get; set; }
    public string PartName { get; set; } = "";
    public int ArrivedQty { get; set; }
    public DateTime? ExpectedDate { get; set; }
    public DateTime? ActualDate { get; set; }
    public string? Remark { get; set; }
    public string Source { get; set; } = "manual";
    public bool AutoScheduleEnabled { get; set; } = true;
    public int Version { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string UpdatedBy { get; set; } = "";
    public DateTime? LastReflowDate { get; set; }
    public string Configuration { get; set; } = "[]";
    public string History { get; set; } = "[]";
    public Order? Order { get; set; }
}
