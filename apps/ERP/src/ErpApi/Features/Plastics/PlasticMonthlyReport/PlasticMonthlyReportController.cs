using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticMonthlyReport;

[ApiController]
[Authorize]
[Route("api/plastic-monthly-report")]
public sealed class PlasticMonthlyReportController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶库存月报表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 月份, string? 物料类别 = null, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.MonthlyAsync(月份, 物料类别, keyword));
    }
}
