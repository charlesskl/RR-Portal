using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.MaterialStocktake;

[ApiController]
[Authorize]
[Route("api/auxiliary-stocktake-query")]
public sealed class AuxiliaryStocktakeQueryController(
    MaterialStocktakeService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料盘点查询";
    private const string Warehouse = "辅料仓库";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var detail = await svc.GetByDocumentAndWarehouseAsync(单号, Warehouse);
        return detail is null ? NotFound() : Ok(detail);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 审核情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.StocktakeQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况, Warehouse);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var row in rows) { row.单价 = null; row.金额 = null; }
        return Ok(rows);
    }

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 物料类别 = null,
        string? 审核情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.StocktakeQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况, Warehouse);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var row in rows) { row.单价 = null; row.金额 = null; }
        return Ok(rows);
    }
}
