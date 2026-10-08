using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessOrderMake;

[ApiController]
[Authorize]
[Route("api/plastic-process-order-make")]
public sealed class PlasticProcessOrderMakeController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶加工订单制作";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ProcessOrderMakeListAsync(起, 止, keyword);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.加工单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    // 已下喷油订单(喷油部收件):已审核塑胶采购订单中供应商含「喷油」的单
    [HttpGet("received")]
    public async Task<IActionResult> Received(DateTime 起, DateTime 止, string? keyword = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SprayOrderReceivedAsync(起, 止, keyword));
    }

    // 喷油部接收订单：标记 喷油接收(已审核的喷油单才可接收)
    [HttpPost("receive")]
    public async Task<IActionResult> Receive([FromQuery(Name = "单号")] string 单号)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.保存)) return Forbid();
        try { await svc.ReceiveSprayOrderAsync(单号, CurrentUser); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }
}
