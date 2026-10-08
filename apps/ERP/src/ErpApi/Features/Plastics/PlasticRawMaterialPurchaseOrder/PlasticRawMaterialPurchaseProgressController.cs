using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-purchase-progress")]
public sealed class PlasticRawMaterialPurchaseProgressController(
    PlasticRawMaterialPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    // 权限照抄相邻端点:gate 在「原料采购订单·打开」(同辅料采购进度表 gate「采购订单」)。
    private const string Menu = "原料采购订单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        string? 供应商 = null,
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        bool onlyOwed = false,
        string? 日期类型 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressAsync(供应商, 起, 止, keyword, onlyOwed, 日期类型));
    }
}
