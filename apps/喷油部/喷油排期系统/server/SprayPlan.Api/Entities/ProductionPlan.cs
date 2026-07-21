namespace SprayPlan.Api.Entities;

// 对应现有 prisma model ProductionPlan（@@map("production_plans")）。系统心脏：
// 一行 = 某天 × 某拉别 × 某订单子件部位 × 计划生产数（不分颜色/规格）。
// 排期填 plannedQty → 实绩补 goodQty（第7阶段）→ 算产值/余下数。
public class ProductionPlan
{
    public int Id { get; set; }

    // 排期维度
    public DateTime PlanDate { get; set; }
    public string PlanType { get; set; } = "daily";   // daily | weekly
    public int LineId { get; set; }

    // 排的对象（部位级，不分颜色/规格）
    public int OrderId { get; set; }
    public string ItemName { get; set; } = "";
    public string PartName { get; set; } = "";
    public int? SourcePartId { get; set; }

    // 资源分配
    public string MachineNos { get; set; } = "[]";    // JSON 机台号数组
    public int PlannedQty { get; set; }
    public int WorkerCount { get; set; } = 1;
    public int? GroupNo { get; set; }                 // 人数分组号：同拉别+同天内共享人数；null=未分组
    public int StepNo { get; set; } = 1;              // 第几道工序（工序链位置号，单道默认 1）
    public string Craft { get; set; } = "";           // 该道工序大类（喷油/移印/UV）

    // 实绩维度（第7阶段写入）
    public int? GoodQty { get; set; }
    public int? ReportedQty { get; set; }   // 员工报数（实际生产数）
    public int DefectQty { get; set; }
    public double WorkHours { get; set; } = 11;
    public double? ProductionValue { get; set; }

    // 状态 / 审计 / 留痕 / 软删
    public string Status { get; set; } = "planned";   // planned | recorded
    public string? Remark { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? LastModifiedBy { get; set; }
    public DateTime LastModifiedAt { get; set; }
    public string ModificationHistory { get; set; } = "[]";
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    public ProductionLine? Line { get; set; }
    public Order? Order { get; set; }
}
