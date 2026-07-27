namespace StitchCostPro.Api.Entities;

/// <summary>② 外发厂 / 供应商档案。</summary>
public class Supplier : AuditableEntity
{
    public int SupplierId { get; set; }
    public string SupplierCode { get; set; } = null!;
    public string SupplierName { get; set; } = null!;
    public string? Contact { get; set; }
    public string? MainProcess { get; set; }            // 主营加工类型（供应商参考信息）
    public int DeptId { get; set; }
    public bool IsActive { get; set; } = true;
    public string? ExtMainId { get; set; }              // 预留：主系统供应商 ID
    public string? Location { get; set; }               // 所在地(东莞/湖南…)
    public string? Remark { get; set; }                 // 备注

    // —— 加工厂信息统计表字段（阶段二）。contact=联系人, main_process=加工类型 复用 ——
    public string? Phone { get; set; }                  // 联系电话(文字)
    public string? Address { get; set; }                // 工厂地址(完整)
    public int? EquipmentCount { get; set; }            // 设备台数/生产拉线
    public int? MachinesForUs { get; set; }             // 帮我们生产的机台/生产线
    public int? EmployeeCount { get; set; }             // 员工人数
    public string? MonthlyCapacity { get; set; }        // 月产能
    public string? Qualification { get; set; }          // 环评/消防/安监资质
    public string? Scope { get; set; }                  // 所属范围

    public Dept? Dept { get; set; }
}
