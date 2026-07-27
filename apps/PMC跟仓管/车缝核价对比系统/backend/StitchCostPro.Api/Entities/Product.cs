namespace StitchCostPro.Api.Entities;

/// <summary>② 货号 / 品名档案。对比主界面每一行的起点。</summary>
public class Product : AuditableEntity
{
    public int ProductId { get; set; }
    public string ProductCode { get; set; } = null!;   // 货号（如 15783）
    public string? SeriesCode { get; set; }             // 系列号/货号(如 15783)，款式分组
    public string? StyleNo { get; set; }                // 款号(如 #1)
    public string ProductName { get; set; } = null!;   // 品名（如 开心鸡块）
    public string? Spec { get; set; }                   // 规格 / 备注
    public int DeptId { get; set; }
    public bool IsActive { get; set; } = true;
    public string? ExtMainId { get; set; }              // 预留：主系统货号 ID

    public Dept? Dept { get; set; }
}
