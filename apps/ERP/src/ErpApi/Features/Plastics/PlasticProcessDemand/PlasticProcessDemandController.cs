using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessDemand;

[ApiController]
[Authorize]
[Route("api/plastic-process-demand")]
public sealed class PlasticProcessDemandController(
    PlasticProcessDemandService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "塑胶物料单";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    // 塑胶仓加工件发外需求:需发 = 需求量 − 白件库存 − 已发未回
    [HttpGet]
    public async Task<IActionResult> Demand([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(生产单号)) return BadRequest(new { 消息 = "请提供生产单号。" });
        return Ok(await svc.DemandAsync(生产单号.Trim()));
    }

    // 选中行按 加工厂编号+加工内容 分组生成 塑胶加工采购单(未审核)
    [HttpPost("create-orders")]
    public async Task<IActionResult> CreateOrders([FromBody] PlasticProcessDemandCreateRequest req)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.保存)) return Forbid();
        if (string.IsNullOrWhiteSpace(req.生产单号)) return BadRequest(new { 消息 = "请提供生产单号。" });
        PlasticProcessDemandCreateResult result;
        try { result = await svc.CreateOrdersAsync(req, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync("塑胶加工采购单", "新增", CurrentUser,
            $"发外需求生成:生产单号={req.生产单号},单号={string.Join(",", result.单号列表)},跳过={result.跳过}", c);
        return Ok(result);
    }
}
