using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessPurchaseProgress;

[ApiController]
[Authorize]
[Route("api/plastic-process-purchase-progress")]
public sealed class PlasticProcessPurchaseProgressController(
    PlasticProcessPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "采购加工进度表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "加工厂")] string? 加工厂 = null,
        [FromQuery(Name = "起")] DateTime? 起 = null, [FromQuery(Name = "止")] DateTime? 止 = null,
        string? keyword = null, bool onlyOwed = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ProgressAsync(加工厂, 起, 止, keyword, onlyOwed);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.订购金额 = null; r.入仓金额 = null; r.剩余金额 = null; }
        return Ok(rows);
    }
}
