using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials.MaterialReturn;

[ApiController]
[Authorize]
[Route("api/material-returns")]
public sealed class MaterialReturnController(
    MaterialReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "退料单";
    private const string Table = "退料单";
    private const string 口径 = "物料";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    private static void MaskDetail(MaterialReturnDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    // 退料单查询·明细：每行一条退料明细(无价格,双击 单号 看整单)。
    [HttpGet("return-query/detail")]
    public async Task<IActionResult> ReturnQueryDetail(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ReturnQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况));
    }

    // 退料单查询·汇总：按 生产单号+物料编号+规格+颜色 合并(退料数量)。
    [HttpGet("return-query/summary")]
    public async Task<IActionResult> ReturnQuerySummary(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ReturnQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况));
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MaterialReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
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
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
