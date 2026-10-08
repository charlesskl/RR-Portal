using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Warehouse.Semi.Labels;

[ApiController]
[Authorize]
[Route("api/semi-finished-label-orders")]
public sealed class SemiFinishedLabelOrderController(
    ISemiFinishedLabelOrderService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "半成品标签单";
    private static readonly HashSet<string> ProductFields =
        ["产品货号", "产品名称", "配件编号", "客户", "产品装配名称"];

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction action) => perms.HasAsync(CurrentUser, Menu, action);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{documentNo}")]
    public async Task<IActionResult> Get(string documentNo)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(documentNo)) return BadRequest(new { 消息 = "电脑单号必填。" });
        var order = await svc.GetAsync(documentNo);
        return order is null ? NotFound() : Ok(order);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SemiFinishedLabelOrderSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try
        {
            var saved = await svc.CreateAsync(dto, CurrentUser);
            return CreatedAtAction(nameof(Get), new { documentNo = saved.电脑单号 }, saved);
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }

    [HttpPut("{documentNo}")]
    public async Task<IActionResult> Update(string documentNo, [FromBody] SemiFinishedLabelOrderSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        if (string.IsNullOrWhiteSpace(documentNo)) return BadRequest(new { 消息 = "电脑单号必填。" });
        try
        {
            var saved = await svc.UpdateAsync(documentNo, dto, CurrentUser);
            return Ok(saved);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpDelete("{documentNo}")]
    public async Task<IActionResult> Delete(string documentNo)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (string.IsNullOrWhiteSpace(documentNo)) return BadRequest(new { 消息 = "电脑单号必填。" });
        try
        {
            if (!await svc.DeleteAsync(documentNo, CurrentUser)) return NotFound();
            return NoContent();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPost("{documentNo}/audit")]
    public async Task<IActionResult> Audit(string documentNo)
        => await SetAuditAsync(documentNo, true, PermissionAction.审核);

    [HttpPost("{documentNo}/reverse-audit")]
    public async Task<IActionResult> ReverseAudit(string documentNo)
        => await SetAuditAsync(documentNo, false, PermissionAction.反审核);

    [HttpGet("{documentNo}/adjacent")]
    public async Task<IActionResult> Adjacent(string documentNo, AdjacentDirection direction = AdjacentDirection.Previous)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(documentNo)) return BadRequest(new { 消息 = "电脑单号必填。" });
        if (await svc.GetAsync(documentNo) is null) return NotFound();
        var adjacent = await svc.GetAdjacentAsync(documentNo, direction);
        return adjacent is null ? NoContent() : Ok(adjacent);
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] SemiFinishedLabelProductQuery query)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (!string.IsNullOrWhiteSpace(query.Field) && !ProductFields.Contains(query.Field))
            return BadRequest(new { 消息 = "查询字段无效。" });
        return Ok(await svc.ProductsAsync(query, await AllowAsync(PermissionAction.单价)));
    }

    private async Task<IActionResult> SetAuditAsync(string documentNo, bool audited, PermissionAction permission)
    {
        if (!await AllowAsync(permission)) return Forbid();
        if (string.IsNullOrWhiteSpace(documentNo)) return BadRequest(new { 消息 = "电脑单号必填。" });
        try
        {
            if (!await svc.SetAuditAsync(documentNo, audited, CurrentUser)) return NotFound();
            return NoContent();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }
}
