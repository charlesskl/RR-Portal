using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Finished;

// 成品入仓查询（汇总/明细报表），复用 成品入仓 权限。
[ApiController]
[Authorize]
[Route("api/finished-receipt-query")]
public sealed class FinishedReceiptQueryController(FinishedReceiptQueryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "成品入仓";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] FinishedReceiptQueryDto query)
        => !await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开) ? Forbid() : Ok(await svc.SummaryAsync(query));

    [HttpGet("detail")]
    public async Task<IActionResult> Detail([FromQuery] FinishedReceiptQueryDto query)
        => !await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开) ? Forbid() : Ok(await svc.DetailAsync(query));
}
