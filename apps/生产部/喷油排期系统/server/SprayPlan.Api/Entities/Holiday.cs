namespace SprayPlan.Api.Entities;

public class Holiday
{
    public int Id { get; set; }
    public DateTime Date { get; set; }
    public string Type { get; set; } = "holiday";   // holiday 休 / workday 补班
    public string? Remark { get; set; }
}
