using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-issue-progress")]
public sealed class PlasticRawMaterialIssueProgressController(
    PlasticRawMaterialStockIssueService svc, IPermissionService perms) : ControllerBase
{
    // 权限照抄相邻端点:gate 在「原料出库表·打开」(同辅料出库进度表 gate「领料单」)。
    private const string Menu = "原料出库表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 领料备注 = null,
        string? 到货情况 = null,
        bool onlyOwed = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.IssueProgressAsync(起, 止, keyword, 领料备注, 到货情况, onlyOwed));
    }
}
