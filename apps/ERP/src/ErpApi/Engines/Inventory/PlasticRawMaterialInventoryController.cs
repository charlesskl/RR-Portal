using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Engines.Inventory;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-inventory")]
public sealed class PlasticRawMaterialInventoryController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料库存统计表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 物料类别 = null, string? keyword = null, string displayMode = "occurred")
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.RawMaterialStockAsync(物料类别, keyword, displayMode));
    }
}
