using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

[ApiController]
[Authorize]
[Route("api/plastic-material-docs")]
public sealed class PlasticMaterialDocController(
    PlasticMaterialDocService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶物料单";
    private const string Table = "塑胶物料单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet("orders")]
    public async Task<IActionResult> Orders(DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        int page = 1, int size = 20, string? 下单情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrdersAsync(起, 止, keyword, page, size, 下单情况));
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.BasisAsync(生产单号);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) r.加工单价 = null;
        return Ok(rows);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
        {
            if (d.单头 is not null) d.单头.金额 = null;
            foreach (var l in d.明细) { l.加工单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticMaterialDocCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
