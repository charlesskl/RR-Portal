using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticPurchaseProgressDetail;

[ApiController]
[Authorize]
[Route("api/plastic-purchase-progress-detail")]
public sealed class PlasticPurchaseProgressDetailController(
    PlasticPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶进度明细表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 完成情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressDetailAsync(供应商, 起, 止, keyword, 完成情况));
    }
}
