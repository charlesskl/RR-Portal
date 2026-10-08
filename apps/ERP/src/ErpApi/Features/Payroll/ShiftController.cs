using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 班次模板 REST(考勤_排班表 CRUD,识别唯一,时刻 "HH:mm")。
[ApiController]
[Authorize]
[Route("api/attendance/shifts")]
public sealed class ShiftController(
    ShiftService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "班次管理";
    private const string Table = "考勤_排班表";
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

    [HttpGet("{识别}")]
    public async Task<IActionResult> Get(string 识别)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var row = await svc.GetAsync(识别);
        return row is null ? NotFound() : Ok(row);
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] ShiftDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.SaveAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("保存", $"识别={dto.识别}");
        return Ok(new { dto.识别 });
    }

    [HttpDelete("{识别}")]
    public async Task<IActionResult> Delete(string 识别)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(识别)) return NotFound();
        await AuditAsync("删除", $"识别={识别}");
        return NoContent();
    }
}
