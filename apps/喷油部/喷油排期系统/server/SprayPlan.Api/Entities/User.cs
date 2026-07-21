namespace SprayPlan.Api.Entities;

// 对应现有 prisma model User（@@map("users")）。
// 字段含义与现有 SQLite 表一致；列名映射在 AppDbContext 里显式声明。
public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";          // 'admin' | 'clerk' | 'viewer'
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}
