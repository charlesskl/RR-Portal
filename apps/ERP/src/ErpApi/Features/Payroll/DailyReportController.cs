using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 刷卡录入 REST（手工录每日刷卡时刻→引擎算法10→日报表整条替换;无金额脱敏）。
[ApiController]
[Authorize]
[Route("api/attendance/daily")]
public sealed class DailyReportController(
    DailyReportService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "刷卡录入";
    private const string Table = "日报表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? 工号 = null, DateTime 开始 = default, DateTime 结束 = default, string? 部门 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(工号, 开始, 结束, 部门));
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] DailySaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.SaveAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("刷卡录入", $"工号={dto.工号}");
        return Ok();
    }
}
