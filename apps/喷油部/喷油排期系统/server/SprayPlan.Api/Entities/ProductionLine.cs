namespace SprayPlan.Api.Entities;

// 对应现有 prisma model ProductionLine（@@map("production_lines")）。拉别（生产线）。
public class ProductionLine
{
    public int Id { get; set; }
    public string Name { get; set; } = "";        // 拉别名（如「A拉」「C拉」「UV拉」）
    public string Workshop { get; set; } = "";     // 车间：兴信A / 华登A
    public string? LeaderName { get; set; }        // 拉长名
    public string CraftType { get; set; } = "移印"; // 工艺类型：手喷 / 移印 / 自动喷 / UV
    public int DailyCapacityLimit { get; set; } // 该拉一天产能上限（件）；0=不卡
    public bool IsActive { get; set; } = true;

    public List<Machine> Machines { get; set; } = new();
}
