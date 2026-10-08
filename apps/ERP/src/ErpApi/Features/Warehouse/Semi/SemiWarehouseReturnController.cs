using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Warehouse.Semi;

[ApiController]
[Authorize]
[Route("api/semi-warehouse-returns")]
public sealed class SemiWarehouseReturnController(
    SemiWarehouseReturnService service,
    IPermissionService permissions,
    IAuditLogger audit,
    ISqlConnectionFactory factory,
    PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "半成品出仓";
    private const string Table = "半成品退仓单";
    private const string Domain = "半成品";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction action) => permissions.HasAsync(CurrentUser, Menu, action);
    private async Task WriteAuditAsync(string action, string no)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, action, CurrentUser, $"单号={no}", c);
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
        => !await AllowAsync(PermissionAction.打开) ? Forbid() : Ok(await service.ListAsync(page, size, keyword));

    [HttpGet("receipts")]
    public async Task<IActionResult> Receipts(int page = 1, int size = 20, string? keyword = null)
        => !await AllowAsync(PermissionAction.打开) ? Forbid() : Ok(await service.ReceiptListAsync(page, size, keyword));

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] SemiWarehouseReturnProductQuery query)
        => !await AllowAsync(PermissionAction.打开) ? Forbid()
           : Ok(await service.ProductsAsync(query, await AllowAsync(PermissionAction.单价)));

    [HttpGet("{no}/adjacent")]
    public async Task<IActionResult> Adjacent(string no, bool next = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (await service.GetAsync(no, false) is null) return NotFound();
        var adj = await service.GetAdjacentAsync(no, next, await AllowAsync(PermissionAction.单价));
        return adj is null ? NoContent() : Ok(adj);
    }

    [HttpGet("{no}")]
    public async Task<IActionResult> Get(string no)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var detail = await service.GetAsync(no, await AllowAsync(PermissionAction.单价));
        return detail is null ? NotFound() : Ok(detail);
    }

    [HttpPost]
    public async Task<IActionResult> Create(SemiWarehouseReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try
        {
            await periodLock.EnsureWarehouseOpenAsync(Domain, dto.仓库, dto.日期 ?? DateTime.Today);
            var no = await service.CreateAsync(dto, CurrentUser);
            await WriteAuditAsync("新增", no);
            return CreatedAtAction(nameof(Get), new { no }, new { 单号 = no });
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPut("{no}")]
    public async Task<IActionResult> Update(string no, SemiWarehouseReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try
        {
            await periodLock.EnsureWarehouseOpenAsync(Domain, dto.仓库, dto.日期 ?? DateTime.Today);
            if (!await service.UpdateAsync(no, dto, CurrentUser)) return NotFound();
            await WriteAuditAsync("修改", no);
            return Ok(await service.GetAsync(no, await AllowAsync(PermissionAction.单价)));
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpDelete("{no}")]
    public async Task<IActionResult> Delete(string no)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await service.DeleteAsync(no)) return NotFound();
            await WriteAuditAsync("删除", no); return NoContent();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPost("{no}/approve")]
    public async Task<IActionResult> Approve(string no)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try
        {
            await periodLock.EnsureHeaderOpenAsync(Domain, Table, no);
            if (!await service.SetApprovedAsync(no, CurrentUser, true)) return Conflict(new { 消息 = "单据不存在或已经审核。" });
            await WriteAuditAsync("审核", no); return NoContent();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPost("{no}/unapprove")]
    public async Task<IActionResult> Unapprove(string no)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        await periodLock.EnsureHeaderOpenAsync(Domain, Table, no);
        if (!await service.SetApprovedAsync(no, CurrentUser, false)) return Conflict(new { 消息 = "单据不存在或尚未审核。" });
        await WriteAuditAsync("反审核", no); return NoContent();
    }
}
