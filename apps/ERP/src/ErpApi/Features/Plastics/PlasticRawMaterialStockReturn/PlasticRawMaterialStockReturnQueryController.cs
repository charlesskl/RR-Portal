using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Plastics.PlasticRawMaterialStockReturn;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-stock-return-query")]
public sealed class PlasticRawMaterialStockReturnQueryController(
    PlasticRawMaterialStockReturnService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料退库查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null,
        [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.StockReturnQuerySummaryAsync(起, 止, keyword, 审核情况, 物料类别));
    }

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null,
        [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.StockReturnQueryDetailAsync(起, 止, keyword, 审核情况, 物料类别));
    }
}
