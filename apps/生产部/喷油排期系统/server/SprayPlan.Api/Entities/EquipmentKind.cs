namespace SprayPlan.Api.Entities;

// 对应 prisma model EquipmentKind（@@map("equipment_kinds")）。机台种类下拉的可增删来源。
public class EquipmentKind
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
