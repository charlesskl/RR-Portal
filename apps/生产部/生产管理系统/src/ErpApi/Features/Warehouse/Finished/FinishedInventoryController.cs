using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Finished;

// 成品库存查询（玩具模型，按 配件编号 实时聚合 + 流水）。仅看库存数量，无价格字段，故只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/finished-inventory")]
public sealed class FinishedInventoryController(
    IInventorySummaryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "成品库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.FinishedGoodsByItemAsync(仓库 ?? "");
        return Ok(rows);
    }

    // 某配件编号在该仓库的出入库流水（结存由前端按返回顺序累计）
    [HttpGet("ledger")]
    public async Task<IActionResult> Ledger(
        [FromQuery(Name = "仓库")] string? 仓库 = null,
        [FromQuery(Name = "配件编号")] string? 配件编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(配件编号)) return BadRequest("配件编号必填。");
        var rows = await inventory.FinishedGoodsLedgerAsync(仓库 ?? "", 配件编号.Trim());
        return Ok(rows);
    }
}
