using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Assembly;

[ApiController]
[Authorize]
[Route("api/assembly-factory-category-detail")]
public sealed class FactoryCategoryDetailController(
    FactoryCategoryDetailService svc, IPermissionService perms) : ControllerBase
{
    // 权限照抄相邻端点:gate 在「款号资料」(同 api/assembly-purchase-query 各端点)。
    private const string Menu = "款号资料";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? 类别 = null,
        string? 加工厂 = null,
        string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ListAsync(起, 止, 类别, 加工厂, keyword);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
}
