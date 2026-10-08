using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials;

// 物料库存查询（算法1 实时聚合）。仅看库存数量，无价格字段，故只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/material-inventory")]
public sealed class MaterialInventoryController(
    IMaterialInventoryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "物料库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null,
        [FromQuery(Name = "物料类别")] string? 物料类别 = null,
        [FromQuery(Name = "含零库存")] bool 含零库存 = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.ListAsync(仓库, keyword, 物料类别, 含零库存);
        return Ok(rows);
    }

    // 左树分类计数（有库存的物料数/类），仅库存统计表使用
    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await inventory.CategoryCountsAsync());
    }
}
