using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Admin;

[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class AdminController(
    AccountService accounts, PermissionAdminService permsvc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "账号管理";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string table, string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(table, behavior, CurrentUser, record, c); }

    [HttpGet("menus")]
    public async Task<IActionResult> Menus()
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(MenuCatalog.All); }

    [HttpGet("accounts")]
    public async Task<IActionResult> List(string? keyword = null)
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(await accounts.ListAsync(keyword)); }

    [HttpPost("accounts")]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await accounts.RegisterAsync(dto.用户名, dto.初始密码, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("sysfileuser", "注册账号", $"用户={dto.用户名}");
        return Ok(new { dto.用户名 });
    }

    [HttpPost("accounts/{用户}/reset-password")]
    public async Task<IActionResult> ResetPwd(string 用户, [FromBody] ResetPwdDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { if (!await accounts.ResetPasswordAsync(用户, dto.新密码)) return NotFound(); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("sysfileuser", "重置密码", $"用户={用户}");
        return NoContent();
    }

    [HttpPost("accounts/{用户}/lock")]
    public async Task<IActionResult> Lock(string 用户)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        if (用户 == CurrentUser) return BadRequest(new { 消息 = "不能停用自己" });
        if (!await accounts.LockAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "停用", $"用户={用户}");
        return NoContent();
    }

    [HttpPost("accounts/{用户}/unlock")]
    public async Task<IActionResult> Unlock(string 用户)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        if (!await accounts.UnlockAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "启用", $"用户={用户}");
        return NoContent();
    }

    [HttpDelete("accounts/{用户}")]
    public async Task<IActionResult> Delete(string 用户)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (用户 == CurrentUser) return BadRequest(new { 消息 = "不能删除自己" });
        if (!await accounts.DeleteAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "删除账号", $"用户={用户}");
        return NoContent();
    }

    [HttpGet("accounts/{用户}/perms")]
    public async Task<IActionResult> GetPerms(string 用户)
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(await permsvc.GetUserPermsAsync(用户)); }

    [HttpPut("accounts/{用户}/perms")]
    public async Task<IActionResult> SavePerms(string 用户, [FromBody] SaveUserPermsDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        // 自我保护:保存自己权限时强制保留「账号管理·打开」,防自锁
        var rows = dto.明细;
        if (用户 == CurrentUser)
        {
            var self = rows.FirstOrDefault(r => r.菜单 == Menu);
            if (self is null) rows = [.. rows, new MenuPermRow { 组 = "管理后台", 菜单 = Menu, 打开 = true }];
            else self.打开 = true;
        }
        try { await permsvc.SaveUserPermsAsync(用户, rows, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("userbqrpower", "保存权限", $"用户={用户},菜单数={rows.Count(r => r.打开||r.保存||r.删除||r.打印||r.单价||r.金额||r.审核||r.反审核||r.功能)}");
        return NoContent();
    }
}
