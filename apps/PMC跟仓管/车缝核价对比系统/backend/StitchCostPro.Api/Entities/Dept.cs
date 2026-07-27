namespace StitchCostPro.Api.Entities;

/// <summary>① 部门 / 工厂。所有业务数据都挂在某个部门下，为外地复制预留。</summary>
public class Dept : AuditableEntity
{
    public int DeptId { get; set; }
    public string DeptCode { get; set; } = null!;     // 部门编码（HQ 本厂 / WD 外地）
    public string DeptName { get; set; } = null!;
    public bool IsActive { get; set; } = true;
    public string? ExtMainId { get; set; }             // 预留：主系统对应部门 ID
}
