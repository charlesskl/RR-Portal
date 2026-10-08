using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品库存查询（算法1 实时聚合，物料维度）。仅看库存数量，无价格字段，只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/semi-inventory")]
public sealed class SemiInventoryController(
    IInventorySummaryService inventory, SemiInventoryReportService report,
    SemiMonthlyReportService monthly, IPermissionService perms) : ControllerBase
{
    private const string Menu = "半成品库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.SemiFinishedAsync(仓库 ?? "");
        return Ok(rows);
    }

    // 库存统计表（富化：客户/产品货号/产品名称/产品装配名称/仓库位置 + 显示/零库存筛选 + 字段查询）
    [HttpGet("report")]
    public async Task<IActionResult> Report([FromQuery] SemiInventoryReportQuery query)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await report.ReportAsync(query));
    }

    // 库存月报表（收发存：期初/入库/出库/报废/盈亏/期末），复用 半成品库存 权限
    [HttpGet("monthly")]
    public async Task<IActionResult> Monthly([FromQuery] SemiMonthlyReportQuery query)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await monthly.ReportAsync(query));
    }
}
