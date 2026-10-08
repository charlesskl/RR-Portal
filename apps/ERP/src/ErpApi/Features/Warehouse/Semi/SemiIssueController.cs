using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品领料 REST。审核/反审核仅翻单头审核位——半成品领料明细单无审核列，库存引擎按单头JOIN过滤审核，
// 故不需要 SyncLineApprovalAsync（与成品出仓不同）。
[ApiController]
[Authorize]
[Route("api/semi-issues")]
public sealed class SemiIssueController(
    SemiIssueService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock,
    PurchaseApprovalChainService chain) : ControllerBase
{
    private const string Menu = "半成品领料";
    private const string Table = "半成品领料单";
    private const string 口径 = "半成品";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
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
        var d = await svc.GetAsync(单号, await AllowAsync(PermissionAction.单价));
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] SemiIssueProductQuery query)
        => !await AllowAsync(PermissionAction.打开) ? Forbid()
           : Ok(await svc.ProductsAsync(query, await AllowAsync(PermissionAction.单价)));

    [HttpGet("{单号}/adjacent")]
    public async Task<IActionResult> Adjacent(string 单号, bool next = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (await svc.GetAsync(单号, false) is null) return NotFound();
        var adj = await svc.GetAdjacentAsync(单号, next, await AllowAsync(PermissionAction.单价));
        return adj is null ? NoContent() : Ok(adj);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SemiIssueCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "半成品仓" : dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] SemiIssueCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "半成品仓" : dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        try
        {
            if (!await svc.UpdateAsync(单号, dto, CurrentUser)) return NotFound();
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("修改", $"单号={单号}");
        return Ok(await svc.GetAsync(单号, await AllowAsync(PermissionAction.单价)));
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

    // 三级流转第一级：主管审核(开单后→主管审核→经理审核→审核)。责任部门=单上[部门](查不到退回 02 装配部)
    [HttpPost("{单号}/supervisor-approve")]
    public async Task<IActionResult> SupervisorApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await chain.SupervisorApproveAsync(Table, 单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("主管审核", $"单号={单号}");
        return NoContent();
    }

    // 三级流转第二级：经理审核(需先主管审核)。经理审完后才可审核
    [HttpPost("{单号}/manager-approve")]
    public async Task<IActionResult> ManagerApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await chain.ManagerApproveAsync(Table, 单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("经理审核", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 门:必须先经主管、经理审核(已审核的历史单不受影响——posting 对它们直接返回 false)
        if (!await chain.IsManagerApprovedAsync(Table, 单号)) return Conflict(new { 消息 = "请先经主管、经理审核。" });
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
