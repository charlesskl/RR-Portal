using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Assembly;

[ApiController]
[Authorize]
[Route("api/assembly-material-summary")]
public sealed class AssemblyMaterialSummaryController(
    AssemblyMaterialSummaryService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "款号资料";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        DateTime? 起 = null,
        DateTime? 止 = null,
        bool 启用日期 = false,
        string? 客户 = null,
        string? 装配方式 = null,
        string? 完成情况 = null,
        string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(起, 止, 启用日期, 客户, 装配方式, 完成情况, keyword));
    }
}
