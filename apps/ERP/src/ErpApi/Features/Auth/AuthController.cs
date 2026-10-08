using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
namespace ErpApi.Features.Auth;

[ApiController]
[Route("api/[controller]")]
public sealed class AuthController(
    AuthService auth, IPermissionService perm,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private async Task AuditAsync(string table, string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(table, behavior, CurrentUser, record, c); }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResult>> Login([FromBody] LoginRequest req)
    {
        var r = await auth.LoginAsync(req.用户, req.密码);
        return r.成功 ? Ok(r) : Unauthorized(r);
    }

    [HttpGet("me/permissions")]
    [Authorize]
    public async Task<IActionResult> MyPermissions()
    {
        var name = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!;
        return Ok(await perm.GetByUserAsync(name));
    }

    [HttpPost("heartbeat")]
    [Authorize]
    public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest req)
    {
        await auth.HeartbeatAsync(CurrentUser, req.活动);
        return Ok(new { 消息 = "ok" });
    }

    // 退出登录:立即置离线(清心跳),前端随后清本地 token
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        await auth.LogoutAsync(CurrentUser);
        await AuditAsync("sysfileuser", "退出登录", $"用户={CurrentUser}");
        return Ok(new { 消息 = "已退出" });
    }

    // 用户自助修改密码：任何登录用户均可改自己的密码（无权限位要求）
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req)
    {
        var r = await auth.ChangePasswordAsync(CurrentUser, req.原密码, req.新密码);
        if (!r.成功) return BadRequest(new { r.消息 });
        await AuditAsync("sysfileuser", "修改密码", $"用户={CurrentUser}");
        return Ok(new { 消息 = "密码修改成功" });
    }
}
