using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Production.Replenishment;

[ApiController]
[Authorize]
[Route("api/replenishments")]
public sealed class ReplenishmentController(
    ReplenishmentService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "补料单";
    private const string Table = "补料单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditLogAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null, string? 审核情况 = null,
        string? 仓库 = null, bool 待采购 = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword, 审核情况, 仓库, 待采购));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ReplenishmentCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditLogAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    // 审核=仓库出库(扣库存,台账实时聚合)
    [HttpPost("{单号}/audit")]
    public async Task<IActionResult> Audit(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.AuditAsync(单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditLogAsync("审核", $"单号={单号}");
        return NoContent();
    }

    // 反审核=撤销出库(库存回滚)
    [HttpPost("{单号}/reverse-audit")]
    public async Task<IActionResult> ReverseAudit(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.ReverseAuditAsync(单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditLogAsync("反审核", $"单号={单号}");
        return NoContent();
    }

    // 标记已采购（采购订单「从补料单带入」保存成功后调用；幂等，已标不报错）
    [HttpPost("{单号}/mark-purchased")]
    public async Task<IActionResult> MarkPurchased(string 单号)
    {
        try { await svc.MarkPurchasedAsync(单号); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditLogAsync("标记已采购", $"单号={单号}");
        return NoContent();
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditLogAsync("删除", $"单号={单号}");
        return NoContent();
    }
}
