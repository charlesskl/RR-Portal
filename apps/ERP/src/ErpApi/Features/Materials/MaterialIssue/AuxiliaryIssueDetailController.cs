using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.MaterialIssue;

[ApiController]
[Authorize]
[Route("api/auxiliary-issue-detail")]
public sealed class AuxiliaryIssueDetailController(
    MaterialIssueService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料出库明细表";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        string? 到货情况 = null,
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 日期类型 = null,
        string? 领料备注 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryIssueDetailAsync(到货情况, 起, 止, keyword, 日期类型, 领料备注));
    }
}
