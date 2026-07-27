namespace StitchCostPro.Api.Entities;

/// <summary>① 用户（登录 + 9 位 userbqrpower 权限，与主系统同款格式）。</summary>
public class SysUser : AuditableEntity
{
    public int UserId { get; set; }
    public string Username { get; set; } = null!;
    public string PasswordHash { get; set; } = null!;  // bcrypt，绝不存明文
    public string DisplayName { get; set; } = null!;
    public int DeptId { get; set; }
    public string? Userbqrpower { get; set; }           // 9 位权限串（旧·保留不用）
    public string? Role { get; set; }                    // 本系统角色：业务/外发/跟单/品质/管理层/管理员
    public bool IsActive { get; set; } = true;
    public string? ExtMainId { get; set; }              // 预留：主系统对应用户 ID

    public Dept? Dept { get; set; }
}
