using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Users;

// —— 对外数据形状（record DTO，与现有范式一致）——
public record UserDto(int UserId, string Username, string DisplayName, string? Role, int DeptId, bool IsActive);
public record UserCreate(string Username, string Password, string DisplayName, string? Role, int DeptId);
public record UserUpdate(string DisplayName, string? Role, int DeptId, bool IsActive);

/// <summary>用户管理服务（仅管理员调用）：建号 / 改资料 / 重置密码。密码一律 bcrypt。</summary>
public class UserService(AppDbContext db, ICurrentUser current)
{
    // 合法角色白名单（与前端 permissions.ts 的 6 角色一致）
    private static readonly string[] Roles = ["业务", "外发", "跟单", "品质", "管理层", "管理员"];

    /// <summary>全部用户列表（按 UserId 升序）。</summary>
    public async Task<List<UserDto>> ListAsync() =>
        await db.SysUsers.AsNoTracking().OrderBy(u => u.UserId)
            .Select(u => new UserDto(u.UserId, u.Username, u.DisplayName, u.Role, u.DeptId, u.IsActive))
            .ToListAsync();

    /// <summary>新建用户：校验非空/角色合法/用户名不重复，密码 bcrypt 后入库。</summary>
    public async Task<(UserDto? dto, string? error)> CreateAsync(UserCreate req)
    {
        if (string.IsNullOrWhiteSpace(req.Username)) return (null, "用户名不能为空");
        if (string.IsNullOrWhiteSpace(req.Password)) return (null, "初始密码不能为空");
        if (req.Role is not null && !Roles.Contains(req.Role)) return (null, "角色不合法");
        if (await db.SysUsers.AnyAsync(u => u.Username == req.Username))
            return (null, $"用户名 {req.Username} 已存在");

        var u = new SysUser
        {
            Username = req.Username.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),  // 绝不存明文
            DisplayName = req.DisplayName.Trim(),
            Role = req.Role,
            DeptId = req.DeptId,
            IsActive = true,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.SysUsers.Add(u);
        await db.SaveChangesAsync();
        return (new UserDto(u.UserId, u.Username, u.DisplayName, u.Role, u.DeptId, u.IsActive), null);
    }

    /// <summary>改资料：显示名/角色/部门/启用停用（不在此改密码）。</summary>
    public async Task<(UserDto? dto, string? error)> UpdateAsync(int id, UserUpdate req)
    {
        if (req.Role is not null && !Roles.Contains(req.Role)) return (null, "角色不合法");
        var u = await db.SysUsers.FindAsync(id);
        if (u is null) return (null, "用户不存在");

        u.DisplayName = req.DisplayName.Trim();
        u.Role = req.Role;
        u.DeptId = req.DeptId;
        u.IsActive = req.IsActive;
        u.UpdatedBy = current.UserId;
        u.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (new UserDto(u.UserId, u.Username, u.DisplayName, u.Role, u.DeptId, u.IsActive), null);
    }

    /// <summary>重置密码：新密码 bcrypt 覆盖旧 hash。</summary>
    public async Task<string?> ResetPasswordAsync(int id, string newPassword)
    {
        if (string.IsNullOrWhiteSpace(newPassword)) return "新密码不能为空";
        var u = await db.SysUsers.FindAsync(id);
        if (u is null) return "用户不存在";

        u.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
        u.UpdatedBy = current.UserId;
        u.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return null;
    }
}
