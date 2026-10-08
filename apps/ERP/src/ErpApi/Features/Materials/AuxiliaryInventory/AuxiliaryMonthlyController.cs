using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.AuxiliaryInventory;

[ApiController]
[Authorize]
[Route("api/auxiliary-monthly")]
public sealed class AuxiliaryMonthlyController(
    IMaterialInventoryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料库存月报表";
    private const string Warehouse = "辅料仓库";
    private const string Category = "辅料资料";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] DateTime 起, [FromQuery] DateTime 止, string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.MonthlyAsync(起, 止, Warehouse, Category, keyword);
        return Ok(rows);
    }
}
