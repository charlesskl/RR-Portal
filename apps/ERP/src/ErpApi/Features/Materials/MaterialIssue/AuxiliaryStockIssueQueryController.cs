using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.MaterialIssue;

[ApiController]
[Authorize]
[Route("api/auxiliary-stock-issue-query")]
public sealed class AuxiliaryStockIssueQueryController(
    MaterialIssueService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料出库查询";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 日期类型 = null,
        string? 领料备注 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryStockIssueQuerySummaryAsync(起, 止, keyword, 物料类别, 日期类型, 领料备注));
    }

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 日期类型 = null,
        string? 领料备注 = null,
        string? 制单人 = null,
        string? 审核情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryStockIssueQueryDetailAsync(起, 止, keyword, 物料类别, 日期类型, 领料备注, 制单人, 审核情况));
    }
}
