using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-issue-progress-detail")]
public sealed class PlasticRawMaterialIssueProgressDetailController(
    PlasticRawMaterialStockIssueService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "出库进度明细表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 到货情况 = null,
        string? 日期类型 = null,
        string? 领料备注 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressDetailAsync(起, 止, keyword, 到货情况, 日期类型, 领料备注));
    }
}
