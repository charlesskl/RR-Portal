using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-receipts")]
public sealed class FinishedReceiptController(
    FinishedReceiptService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "成品入仓";
    private const string Table = "成品入仓单";
    private const string 口径 = "成品";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }
    // 成品库存按 成品入仓明细单.审核 过滤；审核/反审核走 svc 自建事务：翻单头 + 同步明细审核位原子完成

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] FinishedReceiptProductQuery query)
        => !await AllowAsync(PermissionAction.打开) ? Forbid() : Ok(await svc.ProductsAsync(query));

    [HttpGet("{单号}/adjacent")]
    public async Task<IActionResult> Adjacent(string 单号, bool next = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (await svc.GetAsync(单号) is null) return NotFound();
        var adj = await svc.GetAdjacentAsync(单号, next);
        if (adj is null) return NoContent();
        if (!await AllowAsync(PermissionAction.单价)) foreach (var l in adj.明细) { l.单价 = null; l.金额 = null; }
        return Ok(adj);
    }

    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] FinishedReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "成品仓" : dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        try { if (!await svc.UpdateAsync(单号, dto, CurrentUser)) return NotFound(); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("修改", $"单号={单号}");
        var d = await svc.GetAsync(单号);
        if (d is not null && !await AllowAsync(PermissionAction.单价)) foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        return Ok(d);
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        try { await svc.ValidatePlanCapAsync(单号); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        if (!await svc.ApproveAsync(单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await svc.UnapproveAsync(单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
