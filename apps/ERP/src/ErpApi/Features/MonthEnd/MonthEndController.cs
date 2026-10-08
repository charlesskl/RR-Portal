using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.MonthEnd;

// 库存月结 REST。打开=看月报/已结月份、功能=月结、删除=反月结。物料金额列缺 单价 权限时脱敏。
[ApiController]
[Authorize]
[Route("api/month-end")]
public sealed class MonthEndController(
    MonthEndService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "库存月结";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync("结存快照表", behavior, CurrentUser, record, c);
    }

    [HttpGet]
    public async Task<IActionResult> Report(
        [FromQuery(Name = "年月")] string 年月, [FromQuery(Name = "口径")] string 口径,
        [FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        IReadOnlyList<MonthEndRow> rows;
        try { rows = await svc.ReportAsync(年月, 口径, 仓库); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows)
            { r.期初金额 = null; r.本期入金额 = null; r.本期出金额 = null; r.结存金额 = null; r.加权单价 = null; }
        return Ok(rows);
    }

    [HttpGet("periods")]
    public async Task<IActionResult> Periods([FromQuery(Name = "口径")] string 口径)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        try { return Ok(await svc.PeriodsAsync(口径)); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }

    [HttpPost("close")]
    public async Task<IActionResult> Close([FromBody] MonthEndCloseRequest req)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        MonthEndCloseResult res;
        try { res = await svc.CloseAsync(req, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("月结", $"年月={req.年月} 口径={req.口径} 仓库数={res.仓库.Count} 结数={res.结数}");
        return Ok(res);
    }

    [HttpPost("reopen")]
    public async Task<IActionResult> Reopen([FromBody] MonthEndReopenRequest req)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        int n;
        try { n = await svc.ReopenAsync(req, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("反月结", $"年月={req.年月} 口径={req.口径} 删数={n}");
        return Ok(new { 删数 = n });
    }
}
