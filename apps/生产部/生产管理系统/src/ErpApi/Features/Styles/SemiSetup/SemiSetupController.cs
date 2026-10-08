using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Styles.SemiSetup;

[ApiController]
[Authorize]
[Route("api/semi-setups")]
public sealed class SemiSetupController(SemiSetupService svc) : ControllerBase
{
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    // 某货号全部半成品设置（含明细）
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? 货号)
    {
        if (string.IsNullOrWhiteSpace(货号)) return BadRequest(new { 消息 = "货号必填。" });
        return Ok(await svc.ListAsync(货号.Trim()));
    }

    // 新建一组半成品设置，操作员取当前登录用户
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SemiSetupSaveDto dto)
    {
        long id;
        try { id = await svc.CreateAsync(dto, CurrentUser); }
        catch (InvalidOperationException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return Ok(new { id });
    }

    // 修改一组设置：名称+明细整组替换(货号/顺序/创建时间不动)
    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] SemiSetupSaveDto dto)
    {
        try { if (!await svc.UpdateAsync(id, dto, CurrentUser)) return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        await svc.DeleteAsync(id);
        return NoContent();
    }
}
