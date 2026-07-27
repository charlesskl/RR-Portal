using System.Security.Claims;

namespace StitchCostPro.Api.Shared;

/// <summary>从 JWT 读取当前登录用户信息（用于审计字段、部门数据隔离）。</summary>
public interface ICurrentUser
{
    int? UserId { get; }
    int? DeptId { get; }
    string? Username { get; }
    string? Userbqrpower { get; }
    string? Role { get; }
}

public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public int? UserId => GetInt(ClaimTypes.NameIdentifier);
    public int? DeptId => GetInt("dept_id");
    public string? Username => Principal?.FindFirstValue(ClaimTypes.Name);
    public string? Userbqrpower => Principal?.FindFirstValue("userbqrpower");
    public string? Role => Principal?.FindFirstValue(ClaimTypes.Role);

    private int? GetInt(string claim) =>
        int.TryParse(Principal?.FindFirstValue(claim), out var v) ? v : null;
}
