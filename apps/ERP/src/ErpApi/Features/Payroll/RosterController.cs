using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 排班 REST(排班表,批量按 工号×日期范围 派班次,工号+日期去重)。
[ApiController]
[Authorize]
[Route("api/attendance/rosters")]
public sealed class RosterController(
    RosterService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "排班";
    private const string Table = "排班表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(DateTime 开始, DateTime 结束, string? 部门编号 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(开始, 结束, 部门编号));
    }

    [HttpPost("assign")]
    public async Task<IActionResult> Assign([FromBody] RosterAssignDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.AssignAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("排班", $"工号数={dto.工号集合.Count},班次={dto.班次}");
        return Ok();
    }

    [HttpDelete]
    public async Task<IActionResult> Delete(string 工号, DateTime 日期)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.RemoveAsync(工号, 日期)) return NotFound();
        await AuditAsync("删除排班", $"工号={工号},日期={日期:yyyy-MM-dd}");
        return NoContent();
    }
}
