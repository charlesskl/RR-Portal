using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-order-receipt-stats")]
public sealed class PlasticRawMaterialOrderReceiptStatController(
    PlasticRawMaterialPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料订货入库统计";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrderReceiptStatsAsync(起, 止, keyword));
    }
}
