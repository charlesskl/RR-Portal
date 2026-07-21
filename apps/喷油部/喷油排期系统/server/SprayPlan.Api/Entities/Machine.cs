namespace SprayPlan.Api.Entities;

// 对应现有 prisma model Machine（@@map("machines")）。机台库。
public class Machine
{
    public int Id { get; set; }
    public string MachineNo { get; set; } = "";        // 机台号（5# / 21# / 38#…），唯一
    public int LineId { get; set; }
    public string MachineType { get; set; } = "移印";  // 机型（移印 / 自动喷 / UV / 炒货…）
    public bool IsUV { get; set; }
    public bool IsActive { get; set; } = true;
    public string EquipmentKind { get; set; } = "普通";  // 机台种类：炒货机/胭脂机/贴片机/普通（库存识别炒货超额用）

    public ProductionLine? Line { get; set; }
}
