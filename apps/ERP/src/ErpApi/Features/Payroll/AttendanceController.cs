using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 月度出勤汇总只读报表（无金额,不脱敏）。打开权限可看。
[ApiController]
[Authorize]
[Route("api/payroll/attendance")]
public sealed class AttendanceController(AttendanceService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "出勤汇总";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> Monthly(
        [FromQuery(Name = "月份")] string 月份,
        [FromQuery(Name = "应出勤天数")] decimal 应出勤天数 = 0,
        [FromQuery(Name = "部门编号")] string? 部门编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        try { return Ok(await svc.MonthlyAsync(月份, 应出勤天数, 部门编号)); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }
}
