using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticWarehouseReturnQuery;

[ApiController]
[Authorize]
[Route("api/plastic-warehouse-return-query")]
public sealed class PlasticWarehouseReturnQueryController(
    PlasticWarehouseReturnService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶退仓查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> CanPrice() => perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.WhReturnQueryDetailAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.WhReturnQuerySummaryAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) { r.金额 = null; }
        return Ok(rows);
    }
}
