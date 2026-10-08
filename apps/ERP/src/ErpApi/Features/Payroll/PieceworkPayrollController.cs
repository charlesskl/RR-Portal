using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 计件归集(算法2)只读报表。打开权限可看;计件工资按 单价 权限脱敏(同 M6 计件汇总)。
[ApiController]
[Authorize]
[Route("api/payroll/piecework")]
public sealed class PieceworkPayrollController(PieceworkPayrollService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "计件归集";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> Monthly([FromQuery(Name = "月份")] string 月份, [FromQuery(Name = "部门编号")] string? 部门编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        IReadOnlyList<PieceworkPayrollRow> rows;
        try { rows = await svc.MonthlyAsync(月份, 部门编号); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) r.计件工资 = null;
        return Ok(rows);
    }
}
