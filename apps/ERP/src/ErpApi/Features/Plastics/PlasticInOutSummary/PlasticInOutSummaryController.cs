using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticInOutSummary;

[ApiController]
[Authorize]
[Route("api/plastic-in-out-summary")]
public sealed class PlasticInOutSummaryController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶物料进出汇总";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? 物料类别 = null, string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.InOutSummaryAsync(起, 止, 物料类别, keyword));
    }
}
