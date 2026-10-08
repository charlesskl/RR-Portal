using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.PurchaseOrder;

[ApiController]
[Authorize]
[Route("api/auxiliary-order-receipt-stats")]
public sealed class AuxiliaryOrderReceiptStatController(
    PurchaseOrderService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料订货入库统计";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] DateTime 起,
        [FromQuery] DateTime 止,
        [FromQuery] string? 日期类型 = null,
        string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryOrderReceiptStatsAsync(起, 止, keyword, 日期类型));
    }
}
