using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-purchase-order-query")]
public sealed class PlasticRawMaterialPurchaseOrderQueryController(
    PlasticRawMaterialPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料采购订单查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 日期类型 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.OrderQueryDetailAsync(起, 止, keyword, 物料类别, 日期类型);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

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
        return Ok(await svc.OrderQuerySummaryAsync(起, 止, keyword, 物料类别, 日期类型, 按供应商));
    }
}
