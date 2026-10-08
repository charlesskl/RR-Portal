using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticCustomerType;

[ApiController]
[Authorize]
[Route("api/plastic-customer-type-stats")]
public sealed class PlasticCustomerTypeController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶类型客户统计";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? 客户 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.CustomerTypeStatsAsync(起, 止, 客户);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.金额))
            foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
}
