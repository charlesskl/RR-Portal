using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payables;

// 应付对账(算法5 只读报表)。有「应付对账」打开权限即看金额(不逐列脱敏)。
[ApiController]
[Authorize]
[Route("api/payables")]
public sealed class PayablesController(PayablesService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "应付对账";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("supplier")]
    public async Task<IActionResult> Supplier([FromQuery(Name = "供应商编号")] string? 供应商编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SupplierAsync(供应商编号));
    }

    [HttpGet("factory")]
    public async Task<IActionResult> Factory([FromQuery(Name = "加工厂编号")] string? 加工厂编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactoryAsync(加工厂编号));
    }

    [HttpGet("supplier-settlement")]
    public async Task<IActionResult> SupplierSettlement([FromQuery(Name = "供应商编号")] string? 供应商编号 = null, [FromQuery(Name = "仅未结清")] bool 仅未结清 = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SupplierSettlementAsync(供应商编号, 仅未结清));
    }

    [HttpGet("supplier-aging")]
    public async Task<IActionResult> SupplierAging([FromQuery(Name = "供应商编号")] string? 供应商编号 = null, [FromQuery(Name = "基准日")] DateTime? 基准日 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SupplierAgingAsync(供应商编号, 基准日));
    }

    [HttpGet("supplier-unpaid")]
    public async Task<IActionResult> SupplierUnpaid([FromQuery(Name = "供应商编号")] string? 供应商编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(供应商编号)) return BadRequest(new { 消息 = "供应商编号必填" });
        return Ok(await svc.SupplierUnpaidAsync(供应商编号));
    }

    [HttpGet("factory-settlement")]
    public async Task<IActionResult> FactorySettlement([FromQuery(Name = "加工厂编号")] string? 加工厂编号 = null, [FromQuery(Name = "仅未结清")] bool 仅未结清 = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactorySettlementAsync(加工厂编号, 仅未结清));
    }

    [HttpGet("factory-aging")]
    public async Task<IActionResult> FactoryAging([FromQuery(Name = "加工厂编号")] string? 加工厂编号 = null, [FromQuery(Name = "基准日")] DateTime? 基准日 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactoryAgingAsync(加工厂编号, 基准日));
    }

    [HttpGet("factory-unpaid")]
    public async Task<IActionResult> FactoryUnpaid([FromQuery(Name = "加工厂编号")] string? 加工厂编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(加工厂编号)) return BadRequest(new { 消息 = "加工厂编号必填" });
        return Ok(await svc.FactoryUnpaidAsync(加工厂编号));
    }
}
