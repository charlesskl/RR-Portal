using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Production.Piecework;

[ApiController]
[Authorize]
[Route("api/piecework")]
public sealed class PieceworkController(
    PieceworkService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "计件";
    private const string Table = "计件表";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 录入计件（批量）
    [HttpPost]
    public async Task<IActionResult> Record([FromBody] PieceworkRecordDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        int 录入条数;
        try { 录入条数 = await svc.RecordAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("新增", $"生产单={dto.生产单号},{录入条数}条");
        return StatusCode(StatusCodes.Status201Created, new { 录入条数 });
    }

    // 查询某生产单的计件（成本保密：无"单价"权限剥离 单价/金额）
    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.ListByOrderAsync(生产单号);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(id)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"计件ID={id}");
        return NoContent();
    }

    // 批量审核某生产单的未审核计件
    [HttpPost("approve")]
    public async Task<IActionResult> Approve([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        var n = await svc.ApproveByOrderAsync(生产单号, CurrentUser);
        await AuditAsync("审核", $"生产单={生产单号},计件{n}条");
        return NoContent();
    }

    // 计件汇总（算法2 前身）：按 员工×工序 归集已审核计件。独立"计件汇总"菜单控权；金额按"单价"权限脱敏。
    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery(Name = "生产单号")] string 生产单号)
    {
        const string summaryMenu = "计件汇总";
        if (!await perms.HasAsync(CurrentUser, summaryMenu, PermissionAction.打开)) return Forbid();
        var rows = await svc.SummaryAsync(生产单号);
        if (!await perms.HasAsync(CurrentUser, summaryMenu, PermissionAction.单价))
            foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
}
