using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 工资表 REST：生成(功能) / 列表·详情(打开,打开即看金额无脱敏) / 反生成(删除)。
// 公式错误(FormulaException)与参数错误(ArgumentException)均转 400。
[ApiController]
[Authorize]
[Route("api/payroll/wages")]
public sealed class PayrollController(
    PayrollService gen, PayrollQueryService q, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "工资表";
    private const string Table = "工资总表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpPost]
    public async Task<IActionResult> Generate([FromBody] PayrollGenerateDto dto)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        string no;
        try { no = await gen.GenerateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (FormulaException ex) { return BadRequest(new { 消息 = "公式错误: " + ex.Message }); }
        await AuditAsync("生成", $"工资表编号={no},月份={dto.月份},部门={dto.部门编号}");
        return Ok(new { 工资表编号 = no });
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "月份")] string? 月份 = null,
        [FromQuery(Name = "部门编号")] string? 部门编号 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await q.ListAsync(月份, 部门编号));
    }

    [HttpGet("{工资表编号}")]
    public async Task<IActionResult> Detail(string 工资表编号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await q.GetDetailAsync(工资表编号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpDelete("{工资表编号}")]
    public async Task<IActionResult> Delete(string 工资表编号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (await gen.DeleteAsync(工资表编号) == 0) return NotFound();
        await AuditAsync("反生成", $"工资表编号={工资表编号}");
        return NoContent();
    }
}
