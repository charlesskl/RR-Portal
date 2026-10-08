using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.PurchaseReceipt;

[ApiController]
[Authorize]
[Route("api/purchase-receipts")]
public sealed class PurchaseReceiptController(
    PurchaseReceiptService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "采购入仓单";
    private const string Table = "采购入仓单";
    private const string 口径 = "物料";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    // 审计在业务事务提交后写入(不参与回滚)——与 MasterCrudController 同一项目级权衡
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 成本保密：无"单价"权限剥离单头金额 + 明细单价/金额
    private static void MaskDetail(PurchaseReceiptDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    // 来料标签查询·明细：每行一条采购入仓明细(双击 单号 看整单)。无价格列。


    // 来料标签查询·汇总：按 物料编号+规格+颜色 合并。


    // 采购入仓查询·明细：每行一条采购入仓明细(全列·无价格,双击 入库单号 看整单)。
    [HttpGet("receipt-query/detail")]
    public async Task<IActionResult> ReceiptQueryDetail(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ReceiptQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况));
    }

    // 采购入仓查询·汇总：与来料标签查询共用汇总口径(物料编号+规格+颜色)。
    [HttpGet("receipt-query/summary")]
    public async Task<IActionResult> ReceiptQuerySummary(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null,
        string? 物料类别 = null, string? 审核情况 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.LabelQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况));
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
    public async Task<IActionResult> Create([FromBody] PurchaseReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, dto.日期 ?? DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "关联数据不存在(供应商/款号/生产单号)。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
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

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 审核前再校验订单可入仓数量：防两张未审核入仓单各自不超、先后审核后合计超
        try { await svc.ValidateOrderQtyAsync(单号); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
