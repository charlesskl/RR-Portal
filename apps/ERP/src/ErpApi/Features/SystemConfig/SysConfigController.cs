using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.SystemConfig;

[ApiController]
[Authorize]
[Route("api/sys-config")]
public sealed class SysConfigController(
    SysConfigService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "系统配置";
    private const string Table = "系统配置表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(keyword));
    }

    [HttpGet("{键}")]
    public async Task<IActionResult> Get(string 键)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var r = await svc.GetAsync(键);
        if (r is null) return NotFound();
        return Ok(r);
    }

    [HttpPost]
    public async Task<IActionResult> Upsert([FromBody] SysConfigDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.UpsertAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("保存", $"键={dto.键}");
        return Ok(new { dto.键 });
    }

    [HttpDelete("{键}")]
    public async Task<IActionResult> Delete(string 键)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(键)) return NotFound();
        await AuditAsync("删除", $"键={键}");
        return NoContent();
    }
}
