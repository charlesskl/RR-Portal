using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品退库查询（汇总/明细报表），复用 半成品退库 权限。
[ApiController]
[Authorize]
[Route("api/semi-stock-return-query")]
public sealed class SemiStockReturnQueryController(SemiStockReturnQueryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "半成品退库";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] SemiStockReturnQueryDto query)
        => !await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开) ? Forbid() : Ok(await svc.SummaryAsync(query));

    [HttpGet("detail")]
    public async Task<IActionResult> Detail([FromQuery] SemiStockReturnQueryDto query)
        => !await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开) ? Forbid() : Ok(await svc.DetailAsync(query));
}
