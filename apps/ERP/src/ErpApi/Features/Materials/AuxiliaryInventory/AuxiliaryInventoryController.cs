using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.AuxiliaryInventory;

[ApiController]
[Authorize]
[Route("api/auxiliary-inventory")]
public sealed class AuxiliaryInventoryController(
    IMaterialInventoryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料库存统计表";
    private const string Warehouse = "辅料仓库";
    private const string Category = "辅料资料";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.ListAsync(Warehouse, keyword, Category);
        return Ok(rows);
    }
}
