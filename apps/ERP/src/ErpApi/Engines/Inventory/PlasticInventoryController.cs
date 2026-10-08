using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Engines.Inventory;

[ApiController]
[Authorize]
[Route("api/plastic-inventory")]
public sealed class PlasticInventoryController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶库存";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null, string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ListAsync(仓库, keyword, 物料类别);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
