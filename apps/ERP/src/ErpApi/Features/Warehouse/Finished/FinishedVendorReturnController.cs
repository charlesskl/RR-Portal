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
[Route("api/finished-vendor-returns")]
public sealed class FinishedVendorReturnController(
    FinishedVendorReturnService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "成品出仓单";
    private const string Table = "成品退仓单";
    private const string 口径 = "成品";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }
    // 成品库存按 成品退仓明细单.审核 过滤(出仓 −)；审核/反审核走 svc 自建事务：翻单头 + 同步明细审核位原子完成

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis(string 入仓单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.BasisAsync(入仓单号);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) r.单价 = null;
        return Ok(rows);
    }


    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedVendorReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "供应商/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return StatusCode(201, new { 单号 }); // Get 详情接口已删(死接口清理),直接返回单号
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
