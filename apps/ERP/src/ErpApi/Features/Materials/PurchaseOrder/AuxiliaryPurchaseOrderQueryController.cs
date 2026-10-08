using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.PurchaseOrder;

[ApiController]
[Authorize]
[Route("api/auxiliary-purchase-order-query")]
public sealed class AuxiliaryPurchaseOrderQueryController(
    PurchaseOrderService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料采购订单查询";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 日期类型 = null,
        bool 按供应商 = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryPurchaseOrderQuerySummaryAsync(起, 止, keyword, 物料类别, 日期类型, 按供应商));
    }

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 日期类型 = null,
        string? 审核情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryPurchaseOrderQueryDetailAsync(起, 止, keyword, 物料类别, 日期类型, 审核情况));
    }
}
