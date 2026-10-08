using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production;

[ApiController]
[Authorize]
[Route("api/production")]
public sealed class ProductionController(
    ProductionService svc, MoTrackingService mo, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "生产制单";
    private const string Table = "生产制单";

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

    // 成本保密：无"单价"权限时剥离一切价格/金额字段（后端落实）
    private static void MaskHeader(ProductionHeaderDto h)
    { h.工序单价 = null; h.物料金额 = null; h.出货单价 = null; }

    private static void MaskDetail(ProductionDetailDto d)
    {
        if (d.单头 is not null) MaskHeader(d.单头);
        foreach (var p in d.工序) p.单价 = null;
        foreach (var b in d.物料) { b.预算单价 = null; b.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) MaskHeader(h);
        return Ok(result);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.SummaryAsync(keyword));
    }

    [HttpGet("{生产单号}")]
    public async Task<IActionResult> Get(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(生产单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    // 领料应领明细(供领料单按生产单一键带入):档=来料/塑胶 过滤档案;档=半成品/成品 取该生产单对应仓现存净额
    // 按货号=true 仅对来料/塑胶档生效:按 货号+物料 分组返回(批量领料按货号挑选用),半成品/成品档忽略
    [HttpGet("{生产单号}/issue-basis")]
    public async Task<IActionResult> IssueBasis(string 生产单号, string? 档 = null, bool 按货号 = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.IssueBasisAsync(生产单号, 档, 按货号));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProductionNoticeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 生产单号;
        try { 生产单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547)  // FK 违反
        { return BadRequest(new { 消息 = "款号/客户/加工厂不存在，请先在基础资料中建立。" }); }
        await AuditAsync("新增", $"单号={生产单号}");
        return CreatedAtAction(nameof(Get), new { 生产单号 }, new { 生产单号 });
    }

    [HttpPut("{生产单号}")]
    public async Task<IActionResult> Update(string 生产单号, [FromBody] ProductionNoticeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        bool ok;
        try { ok = await svc.UpdateHeaderAsync(生产单号, dto, CurrentUser); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!ok) return NotFound();
        await AuditAsync("修改", $"单号={生产单号}");
        return NoContent();
    }

    [HttpDelete("{生产单号}")]
    public async Task<IActionResult> Delete(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await svc.DeleteAsync(生产单号)) return NotFound();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 外键兜底(547):预防新增引用表漏进前置清单,转 409 中文提示而非裸 500
        catch (SqlException ex) when (ex.Number == 547) { return Conflict(new { 消息 = "该生产单已被引用，不可删除" }); }
        await AuditAsync("删除", $"单号={生产单号}");
        return NoContent();
    }

    // —— MO单录入（生产通知单MO单；独立保存，不参与主单据创建/审核流程） ——
    [HttpGet("{生产单号}/mo")]
    public async Task<IActionResult> GetMo(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await mo.GetAsync(生产单号));
    }

    [HttpPut("{生产单号}/mo")]
    public async Task<IActionResult> SaveMo(string 生产单号, [FromBody] List<MoLineDto> rows)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        await mo.SaveAsync(生产单号, rows ?? []);
        await AuditAsync("保存MO单", $"单号={生产单号}");
        return NoContent();
    }

    [HttpPost("{生产单号}/approve")]
    public async Task<IActionResult> Approve(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 生产单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    // 采购分析审核(采购物料分析独立审核层):前置=生产通知单已审核;审过才允许来料下采购订单
    [HttpPost("{生产单号}/purchase-analysis-audit")]
    public async Task<IActionResult> PurchaseAnalysisAudit(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try
        {
            if (!await svc.PurchaseAnalysisAuditAsync(生产单号, CurrentUser))
                return Conflict(new { 消息 = "采购分析单已是已审核状态。" });
        }
        catch (ArgumentException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("采购分析审核", $"单号={生产单号}");
        return NoContent();
    }

    // 采购分析反审核(与采购订单同规则):反审后回到未审核,可重新查看明细再审核
    [HttpPost("{生产单号}/purchase-analysis-unaudit")]
    public async Task<IActionResult> PurchaseAnalysisUnaudit(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await svc.PurchaseAnalysisUnauditAsync(生产单号))
            return Conflict(new { 消息 = "采购分析单未审核或不存在。" });
        await AuditAsync("采购分析反审核", $"单号={生产单号}");
        return NoContent();
    }

    [HttpPost("{生产单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        // 反审核必须走「申请 → 经理批准」流；直接反审核仅经理/admin 可执行(防绕过)
        if (!await svc.IsManagerAsync(CurrentUser))
            return Conflict(new { 消息 = "反审核需先提交申请，由经理在消息中心批准后生效。" });
        if (!await posting.UnapproveAsync(Table, 生产单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        // 源单反审核 → 采购分析连带回未审核(必须重新审核才能再下单)
        await svc.ResetPurchaseAnalysisAuditAsync(生产单号);
        return NoContent();
    }

    // —— 反审核申请-审批流：申请(反审核权限) → 经理同意/拒绝(消息中心) ——
    [HttpPost("{生产单号}/unapprove-request")]
    public async Task<IActionResult> RequestUnapprove(string 生产单号, [FromBody] UnapproveRequestDto dto)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await svc.RequestUnapproveAsync(生产单号, dto.原因, dto.含BOM, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("申请反审核", $"单号={生产单号}");
        return NoContent();
    }

    [HttpPost("{生产单号}/unapprove-request/approve")]
    public async Task<IActionResult> ApproveUnapproveRequest(string 生产单号)
    {
        try { await svc.ApproveUnapproveRequestAsync(生产单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        // 经理批准反审核 → 采购分析连带回未审核
        await svc.ResetPurchaseAnalysisAuditAsync(生产单号);
        await AuditAsync("反审核", $"单号={生产单号}(经理批准申请)");
        return NoContent();
    }

    [HttpPost("{生产单号}/unapprove-request/reject")]
    public async Task<IActionResult> RejectUnapproveRequest(string 生产单号)
    {
        try { await svc.RejectUnapproveRequestAsync(生产单号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("拒绝反审核", $"单号={生产单号}");
        return NoContent();
    }
}
