namespace StitchCostPro.Api.Entities;

/// <summary>
/// 通用审计基类。对应数据库设计「全局约定」：created_by/created_at/updated_by/updated_at。
/// 列名由 AppDbContext 的 snake_case 约定自动映射（CreatedBy -> created_by）。
/// </summary>
public abstract class AuditableEntity
{
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public int? UpdatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
