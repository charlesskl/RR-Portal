using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.PurchaseSettings;

[ApiController]
[Authorize]
[Route("api/purchase-material-settings")]
public sealed class PurchaseMaterialSettingsController(
    PurchaseMaterialSettingsService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = PurchaseMaterialSettingsService.Menu;

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction action) => perms.HasAsync(CurrentUser, Menu, action);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    // 下游单据/分析预填用: 任何登录用户可读(运营默认值, 非敏感), 不走设置页菜单权限,
    // 否则没有"采购物料设置·打开"权限的录单员拿不到预填值。
    [HttpGet("lookup/{materialCode}")]
    public async Task<IActionResult> Lookup(string materialCode)
    {
        var row = await svc.FindAsync(materialCode);
        return row is null ? NotFound() : Ok(row);
    }

    [HttpPut("{materialCode}")]
    public async Task<IActionResult> Upsert(string materialCode, [FromBody] PurchaseMaterialSettingSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try
        {
            return Ok(await svc.UpsertAsync(materialCode, dto, CurrentUser));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }

    [HttpDelete("{materialCode}")]
    public async Task<IActionResult> Delete(string materialCode)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await svc.DeleteAsync(materialCode, CurrentUser)) return NotFound();
            return NoContent();
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }
}
