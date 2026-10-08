using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Assembly;

[ApiController]
[Authorize]
[Route("api/assembly-purchase-query")]
public sealed class AssemblyPurchaseQueryController(
    AssemblyPurchaseQueryService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "款号资料";
    private const string MaterialIssueMenu = "来料领料单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(
        DateTime 起,
        DateTime 止,
        string? keyword = null,
        string? 收货仓库 = null,
        string? 审核情况 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SummaryAsync(起, 止, keyword, 收货仓库, 审核情况));
    }

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(
        DateTime 起,
        DateTime 止,
        string? keyword = null,
        string? 收货仓库 = null,
        string? 审核情况 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.DetailAsync(起, 止, keyword, 收货仓库, 审核情况));
    }

    [HttpGet("tracking")]
    public async Task<IActionResult> Tracking(
        DateTime 起,
        DateTime 止,
        string? keyword = null,
        string? 收货仓库 = null,
        bool 截止统计 = false)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.TrackingAsync(起, 止, keyword, 收货仓库, 截止统计));
    }

    [HttpGet("factory-inventory")]
    public async Task<IActionResult> FactoryInventory(
        DateTime? 起 = null,
        DateTime? 止 = null,
        bool 启用日期 = false,
        DateTime? 截止日期 = null,
        string? 加工厂 = null,
        string? 物料分类 = null,
        string? 收货仓库 = null,
        string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactoryInventoryAsync(起, 止, 启用日期, 截止日期 ?? DateTime.Today, 加工厂, 物料分类, 收货仓库, keyword));
    }

    [HttpGet("required-materials")]
    public async Task<IActionResult> RequiredMaterials(
        DateTime 起,
        DateTime 止,
        string? keyword = null,
        string? 收货仓库 = null,
        string? 类型 = null,
        string? 审核情况 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.RequiredMaterialsAsync(起, 止, keyword, 收货仓库, 类型, 审核情况));
    }

    [HttpGet("auxiliary-issue-progress")]
    public async Task<IActionResult> AuxiliaryIssueProgress(
        DateTime? 起 = null,
        DateTime? 止 = null,
        string? keyword = null,
        string? 到货情况 = null,
        string? 日期类型 = null,
        string? 领料备注 = null,
        string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, MaterialIssueMenu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryIssueProgressAsync(起, 止, keyword, 到货情况, 日期类型, 领料备注, 物料类别));
    }

    [HttpGet("factory-category-monthly")]
    public async Task<IActionResult> FactoryCategoryMonthly(
        DateTime 起,
        DateTime 止,
        string? 加工厂 = null,
        string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactoryCategoryMonthlyAsync(起, 止, 加工厂, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var detail = await svc.GetAsync(单号);
        return detail is null ? NotFound() : Ok(detail);
    }
}
