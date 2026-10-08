using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.PurchaseOrder;

[ApiController]
[Authorize]
[Route("api/purchase-orders")]
public sealed class PurchaseOrderController(
    PurchaseOrderService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PurchaseApprovalChainService chain) : ControllerBase
{
    private const string Menu = "采购订单";
    private const string Table = "采购订单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 成本保密：无"单价"权限剥离单头金额 + 明细单价/金额
    private static void MaskDetail(PurchaseOrderDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    // 打开：从生产单BOM带料(采购基准)
    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(生产单号)) return BadRequest(new { 消息 = "生产单号必填" });
        IReadOnlyList<PurchaseOrderBasisRow> rows;
        try { rows = await svc.BasisAsync(生产单号); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) r.预算单价 = null;
        return Ok(rows);
    }

    // 订单进度表：采购明细级 订购/入仓/欠数（只读查询）
    [HttpGet("progress")]
    public async Task<IActionResult> Progress(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, bool onlyOwed = false, string? 物料类别 = null, string? 日期类型 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressAsync(供应商, 起, 止, keyword, onlyOwed, 物料类别, 日期类型));
    }

    // 进度明细表：逐条入仓明细 + 未入仓订单行（只读查询）
    [HttpGet("progress-detail")]
    public async Task<IActionResult> ProgressDetail(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 状态 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressDetailAsync(供应商, 起, 止, keyword, 状态));
    }

    // 订购单查询·明细：每行一条采购明细(双击 单号 看整单)。价格按"单价"权限脱敏。
    [HttpGet("order-query/detail")]
    public async Task<IActionResult> OrderQueryDetail(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 物料类别 = null, string? 日期类型 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.OrderQueryDetailAsync(供应商, 起, 止, keyword, 物料类别, 日期类型);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    // 订购单查询·汇总：按 物料编号+规格+颜色 合并(无价格列)。
    [HttpGet("order-query/summary")]
    public async Task<IActionResult> OrderQuerySummary(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 物料类别 = null, string? 日期类型 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrderQuerySummaryAsync(供应商, 起, 止, keyword, 物料类别, 日期类型));
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
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
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PurchaseOrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "关联数据不存在(供应商/物料/生产单号)。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    // 更新:仅未审核可改(已审核 409 中文提示);单事务 单头+明细整组替换
    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] PurchaseOrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        bool ok;
        try { ok = await svc.UpdateAsync(单号, dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "关联数据不存在(供应商/物料/生产单号)。" }); }
        if (!ok) return NotFound();
        await AuditAsync("修改", $"单号={单号}");
        return NoContent();
    }

    // 打印:打印次数+1,返回新计数(权限:采购订单·打印)
    [HttpPost("{单号}/print")]
    public async Task<IActionResult> Print(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打印)) return Forbid();
        var n = await svc.PrintAsync(单号);
        if (n is null) return NotFound();
        await AuditAsync("打印", $"单号={单号},打印次数={n}");
        return Ok(new { 打印次数 = n });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    // 三级流转第一级：主管审核(开单后→主管审核→经理审核→审核)
    [HttpPost("{单号}/supervisor-approve")]
    public async Task<IActionResult> SupervisorApprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await chain.SupervisorApproveAsync(Table, 单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    // 三级流转第二级：经理审核(需先主管审核)。经理审完后才可审核
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
        // 门:必须先经主管、经理审核(已审核的历史单不受影响——posting 对它们直接返回 false)
        if (!await chain.IsManagerApprovedAsync(Table, 单号)) return Conflict(new { 消息 = "请先经主管、经理审核。" });
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
