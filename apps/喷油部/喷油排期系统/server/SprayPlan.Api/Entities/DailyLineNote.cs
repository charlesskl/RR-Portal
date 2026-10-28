namespace SprayPlan.Api.Entities;

// 每个厂区、日期、拉别一条备注，与订单和排期明细独立。
public class DailyLineNote
{
    public int Id { get; set; }
    public string FactoryId { get; set; } = "XINGXIN";
    public int LineId { get; set; }
    public ProductionLine? Line { get; set; }
    public DateTime NoteDate { get; set; }
    public string Text { get; set; } = "";
    public int Version { get; set; }
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}
