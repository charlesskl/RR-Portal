using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Features.Scheduling;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials.MaterialIssue;

[ApiController]
[Authorize]
[Route("api/material-issues")]
public sealed class MaterialIssueController(
    MaterialIssueService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock,
    SchedulingService sched, PurchaseApprovalChainService chain) : ControllerBase
{
    private const string Menu = "来料领料单";
    private const string Table = "领料单";
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

    private static void MaskDetail(MaterialIssueDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    // 领料单查询·明细：每行一条领料明细(无价格,双击 单号 看整单)。
    [HttpGet("issue-query/detail")]
    public async Task<IActionResult> IssueQueryDetail(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.IssueQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况));
    }

    // 领料单查询·汇总：按 物料编号+规格+颜色 合并(领用数量)。
    [HttpGet("issue-query/summary")]
    public async Task<IActionResult> IssueQuerySummary(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.IssueQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况));
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
    public async Task<IActionResult> Create([FromBody] MaterialIssueCreateDto dto)
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

    // 三级流转第一级：部门主管审核(装配部开单后→主管审核→经理审核→来料仓出库)
    [HttpPost("{单号}/supervisor-approve")]
    public async Task<IActionResult> SupervisorApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.SupervisorApproveAsync(单号, CurrentUser); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("主管审核", $"单号={单号}");
        return NoContent();
    }

    // 三级流转第二级：部门经理审核(需先主管审核)。经理审完后来料仓才可出库
    [HttpPost("{单号}/manager-approve")]
    public async Task<IActionResult> ManagerApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.ManagerApproveAsync(单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("经理审核", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/outbound")]
    public async Task<IActionResult> Outbound(string 单号, [FromBody] MaterialIssueOutboundDto dto)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        try
        {
            var r = await svc.OutboundAsync(单号, dto.明细, CurrentUser);
            await AuditAsync("出库", $"单号={单号}");
            // 分次出库全部出完(=整单完成)时：备注含"走货"则溯源排期行置"已走货"
            if (r.完成) await sched.MarkShippedForMaterialIssueAsync(单号, CurrentUser);
            return Ok(r);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 门:必须先经主管、经理审核(已审核的历史单不受影响——svc.ApproveAsync 对它们直接返回 false)
        if (!await chain.IsManagerApprovedAsync(Table, 单号)) return Conflict(new { 消息 = "请先经主管、经理审核。" });
        // 整单审核 = 翻单头 + 全部出库(已出数量=申请数量) 一个事务完成(与分次出库共用 已出数量 口径)
        if (!await svc.ApproveAsync(单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        // 出库联动排期：备注含"走货"则溯源排期行置"已走货"
        await sched.MarkShippedForMaterialIssueAsync(单号, CurrentUser);
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 反审核 = 翻单头 + 撤销全部出库(库存随之回滚) 一个事务完成
        if (!await svc.UnapproveAsync(单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
