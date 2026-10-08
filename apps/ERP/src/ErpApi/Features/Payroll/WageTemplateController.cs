using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 工资模板配置 REST(整组替换,无金额脱敏)。
[ApiController]
[Authorize]
[Route("api/payroll/wage-templates")]
public sealed class WageTemplateController(
    WageTemplateService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "工资模板";
    private const string Table = "工资模板项目";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(keyword));
    }

    [HttpGet("{模板编号}")]
    public async Task<IActionResult> Get(string 模板编号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(模板编号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] WageTemplateSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.SaveAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("保存", $"模板={dto.模板编号},项目数={dto.明细.Count}");
        return Ok(new { dto.模板编号 });
    }

    [HttpDelete("{模板编号}")]
    public async Task<IActionResult> Delete(string 模板编号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(模板编号)) return NotFound();
        await AuditAsync("删除", $"模板={模板编号}");
        return NoContent();
    }
}
