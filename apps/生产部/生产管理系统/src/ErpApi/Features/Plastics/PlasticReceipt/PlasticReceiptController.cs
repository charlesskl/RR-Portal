using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticReceipt;

[ApiController]
[Authorize]
[Route("api/plastic-receipts")]
public sealed class PlasticReceiptController(
    PlasticReceiptService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶入仓单";
    private const string Table = "塑胶入仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null, bool onlyUnapproved = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword, onlyUnapproved);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
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
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
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
        // 审核前再校验订单可入仓数量：防两张未审核入仓单各自不超、先后审核后合计超
        try { await svc.ValidateOrderQtyAsync(单号); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        // 审核成功后推送排产系统入库单;失败只回警告,不阻断审核
        var 警告 = await svc.ApprovePushAsync(单号);
        // 仓库=半成品仓/成品仓时自动生成目标仓入仓单(未审核);失败只回警告,不阻断审核
        string? 提示 = null;
        try
        {
            var 生成 = await svc.GenerateWarehouseReceiptAsync(单号, CurrentUser);
            if (生成 is not null) 提示 = $"已生成{生成}（未审核，待仓库侧审核过账）";
        }
        catch (Exception ex) { 警告 = 警告 is null ? $"自动生成目标仓入仓单失败：{ex.Message}" : $"{警告}；自动生成目标仓入仓单失败：{ex.Message}"; }
        if (提示 is null && 警告 is null) return NoContent();
        return Ok(new { 提示, 警告 });
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        // 反审核前先处理自动生成的目标仓入仓单:未审核→一并删除;对方已审核→阻断反审核
        try { await svc.RemoveGeneratedReceiptIfUnapprovedAsync(单号); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        // 反审核成功后按推送记录删远端排产入库单;失败只回警告,不阻断反审核
        var 警告 = await svc.UnapprovePushAsync(单号);
        return 警告 is null ? NoContent() : Ok(new { 警告 });
    }
}
