using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.PurchaseOrder;

[ApiController]
[Authorize]
[Route("api/auxiliary-progress-detail")]
public sealed class AuxiliaryProgressDetailController(
    PurchaseOrderService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料进度明细表";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? 到货情况 = null,
        [FromQuery] DateTime? 起 = null,
        [FromQuery] DateTime? 止 = null,
        [FromQuery] string? 日期类型 = null,
        [FromQuery] string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryProgressDetailAsync(到货情况, 起, 止, keyword, 日期类型));
    }
}
