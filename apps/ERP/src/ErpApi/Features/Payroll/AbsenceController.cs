using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Payroll;

// 缺勤登记 REST（录入即生效,无审核,无金额脱敏）。
[ApiController]
[Authorize]
[Route("api/payroll/absences")]
public sealed class AbsenceController(
    AbsenceService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "缺勤登记";
    private const string Table = "b缺勤登记明细";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? 月份 = null, string? 工号 = null, string? 部门编号 = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        try { return Ok(await svc.ListAsync(月份, 工号, 部门编号, page, size)); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] AbsenceCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        long id;
        try { id = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "员工不存在。" }); }
        await AuditAsync("新增", $"工号={dto.工号},日期={dto.日期:yyyy-MM-dd}");
        return Ok(new { id });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(id)) return NotFound();
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}
