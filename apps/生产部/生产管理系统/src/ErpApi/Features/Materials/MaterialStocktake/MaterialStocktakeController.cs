using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.MaterialStocktake;

// 物料盘点 REST。审核/反审核走 MaterialStocktakeService 自建事务：翻单头审核位 + 回写/还原 物料资料.库存(采购分析扣数联动)。库存引擎按单头JOIN过滤审核。盘点无单价保密。
[ApiController]
[Authorize]
[Route("api/material-stocktakes")]
public sealed class MaterialStocktakeController(
    MaterialStocktakeService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "盘点单";
    private const string Table = "盘点单";
    private const string 口径 = "物料";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "仓库")] string 仓库)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.BasisAsync(仓库));
    }

    // 盘点单查询·明细：每行一条盘点明细(双击 单号 看整单)。价格按"单价"权限脱敏。
    [HttpGet("stocktake-query/detail")]
    public async Task<IActionResult> StocktakeQueryDetail(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.StocktakeQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    // 盘点单查询·汇总：按 物料编号+规格+颜色 合并(系统/盘点/盈亏数)。价格按"单价"权限脱敏。
    [HttpGet("stocktake-query/summary")]
    public async Task<IActionResult> StocktakeQuerySummary(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.StocktakeQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

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
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MaterialStocktakeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
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
