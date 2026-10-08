using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticPurchaseOrder;

[ApiController]
[Authorize]
[Route("api/plastic-purchase-orders")]
public sealed class PlasticPurchaseOrderController(
    PlasticPurchaseOrderService svc, IPostingEngine posting, IPermissionService perms,
    PurchaseApprovalChainService chain) : ControllerBase
{
    private const string Menu = "塑胶采购订单";
    private const string Table = "塑胶采购订单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(生产单号)) return BadRequest(new { 消息 = "请提供生产单号。" });
        try { return Ok(await svc.BasisAsync(生产单号)); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    // 单头「加工内容」下拉选项：塑胶物料资料/塑胶共用物料表.加工内容 去重非空值
    [HttpGet("processing-contents")]
    public async Task<IActionResult> ProcessingContents()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProcessingContentsAsync());
    }

    // 可加工库存:阶段=一次加工 → 啤机单(无加工内容)入仓的物料;阶段=二次加工(默认) →
    // 已完成一次加工(有加工内容)入仓且实时库存>0 的物料(带已加工工序标记)
    [HttpGet("second-process-stock")]
    public async Task<IActionResult> SecondProcessStock(string? keyword = null, string? 阶段 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.SecondProcessStockAsync(keyword, 阶段));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        // 无「单价」位:委托加工合同打印的单价/金额列留空(照 PlasticMaterialDocController 口径)
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) l.加工单价 = null;
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticPurchaseOrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] PlasticPurchaseOrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { if (!await svc.UpdateAsync(单号, dto, CurrentUser)) return NotFound(); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    // 三级流转第一级：主管审核(开单后→主管审核→经理审核→审核下发)
    [HttpPost("{单号}/supervisor-approve")]
    public async Task<IActionResult> SupervisorApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await chain.SupervisorApproveAsync(Table, 单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    // 三级流转第二级：经理审核(需先主管审核)。经理审完后才可审核(下发排产/喷油)
    [HttpPost("{单号}/manager-approve")]
    public async Task<IActionResult> ManagerApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await chain.ManagerApproveAsync(Table, 单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        // 下发门:必须先经主管、经理审核(已审核的历史单不受影响——posting 对它们直接返回 false)
        if (!await chain.IsManagerApprovedAsync(Table, 单号)) return Conflict(new { 消息 = "请先经主管、经理审核。" });
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        // 审核成功后推送排产系统;失败只回警告,不阻断审核
        var 警告 = await svc.ApprovePushAsync(单号);
        return 警告 is null ? NoContent() : Ok(new { 警告 });
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        // 反审核成功后按推送记录删远端排产订单;失败只回警告,不阻断反审核
        var 警告 = await svc.UnapprovePushAsync(单号);
        return 警告 is null ? NoContent() : Ok(new { 警告 });
    }
}
