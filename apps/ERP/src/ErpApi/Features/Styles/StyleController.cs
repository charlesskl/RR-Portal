using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Styles;

[ApiController]
[Authorize]
[Route("api/styles")]
public sealed class StyleController(
    StyleService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "款号资料";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    // 审计在业务事务提交后写入(不参与回滚)——与 MasterCrudController 同一项目级权衡
    private async Task AuditAsync(string table, string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(table, behavior, CurrentUser, record, c);
    }

    // 款式全貌（主档+颜色+尺码+工序+BOM）；无"单价"权限时剥离所有价格（成本保密）
    [HttpGet("{款号}/full")]
    public async Task<IActionResult> GetFull(string 款号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var dto = await svc.GetFullAsync(款号);
        if (dto is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
        {
            dto.主档.单价 = null; dto.主档.成本价 = null; dto.主档.批发价 = null; dto.主档.零售价 = null;
            foreach (var p in dto.工序) p.单价 = null;
        }
        return Ok(dto);
    }

    // BOM物料设置 轻量载入(仅 款式+物料,提速)
    [HttpGet("{款号}/materials")]
    public async Task<IActionResult> GetMaterials(string 款号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var dto = await svc.GetMaterialsViewAsync(款号);
        if (dto is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
            dto = StyleMaterialsPricePolicy.Redact(dto);
        return Ok(dto);
    }

    // 装配BOM 领料展开(来料领料单「按装配BOM带入」):半成品行 × 半成品设置明细 → 组成物料(带来料/塑胶仓库分类)
    [HttpGet("{款号}/assembly-issue")]
    public async Task<IActionResult> GetAssemblyIssue(string 款号, [FromQuery] decimal 数量 = 1)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.GetAssemblyIssueAsync(款号, 数量));
    }

    [HttpPut("{款号}/colors")]
    public async Task<IActionResult> PutColors(string 款号, [FromBody] List<StyleColorDto> colors)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.ReplaceColorsAsync(款号, colors); }
        catch (InvalidOperationException ex) { return NotFound(new { 消息 = ex.Message }); }
        await AuditAsync("款号颜色表", "修改", $"款号={款号}");
        return NoContent();
    }

    [HttpPut("{款号}/materials")]
    public async Task<IActionResult> PutMaterials(string 款号, [FromBody] BomSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var canEditPrices = await AllowAsync(PermissionAction.单价);
        IReadOnlyList<string> 警告;
        try { 警告 = await svc.ReplaceMaterialsAsync(款号, dto, canEditPrices, CurrentUser); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("不存在"))
        { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("合作方类型"))
        { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        catch (SqlException ex) { return BadRequest(new { 消息 = $"保存失败：数据异常({ex.Number})，请检查物料/款号等关联数据。" }); }
        await AuditAsync("款号物料明细表", "修改", $"款号={款号}");
        // 保存成功但可能有重复扣料风险：警告列表交前端 Modal 提示（不强制阻止）
        return Ok(new { 警告 });
    }

    // 真删除整张 BOM(台头+明细)：未审核才能删,已被生产通知单引用的拒绝;删除权限
    [HttpDelete("{款号}/materials")]
    public async Task<IActionResult> DeleteMaterials(string 款号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { await svc.DeleteBomAsync(款号); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "删除", $"款号={款号}");
        return NoContent();
    }

    // BOM 调入下级半成品的可选款号列表（已设置的半成品/成品）
    [HttpGet("semi-options")]
    public async Task<IActionResult> SemiOptions()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListSemiOptionsAsync());
    }

    // 生产通知单 货号选择:已做 BOM 物料设置的款号及单头信息
    [HttpGet("bom-headers")]
    public async Task<IActionResult> BomHeaders(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListBomHeadersAsync(keyword));
    }

    // 复制单：把源款号 BOM（含装配扩展/报价，若有）复制到目标款号
    [HttpPost("{款号}/copy")]
    public async Task<IActionResult> CopyMaterials(string 款号, [FromBody] StyleBomCopyDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        if (string.IsNullOrWhiteSpace(dto.目标款号))
            return BadRequest(new { 消息 = "请填写目标款号。" });
        try { await svc.CopyMaterialsAsync(款号, dto.目标款号, dto.覆盖); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("不存在"))
        { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("无法复制") || ex.Message.Contains("相同"))
        { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料明细表", "复制", $"款号={款号}→{dto.目标款号.Trim()}");
        return NoContent();
    }

    // BOM 按 PO 号绑定：查绑定列表(按绑定时间排序)
    [HttpGet("{款号}/po-bindings")]
    public async Task<IActionResult> GetPoBindings(string 款号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.GetPoBindingsAsync(款号));
    }

    // 显式绑定 PO 号(=合同号)到 BOM。幂等;空 PO号 → 400
    [HttpPost("{款号}/po-bindings")]
    public async Task<IActionResult> BindPo(string 款号, [FromBody] BomPoBindRequestDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.BindPoAsync(款号, dto.PO号 ?? ""); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料PO绑定", "新增", $"款号={款号},PO号={dto.PO号}");
        return Ok();
    }

    // BOM 台头审核/反审核(款号物料总表.审核;区别于装配审核 半成品共用物料设置.调整审核)
    [HttpPost("{款号}/bom-audit")]
    public async Task<IActionResult> BomAudit(string 款号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.BomSetAuditAsync(款号, true, CurrentUser); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "审核", $"款号={款号}");
        return NoContent();
    }

    [HttpPost("{款号}/bom-reverse-audit")]
    public async Task<IActionResult> BomReverseAudit(string 款号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        // 反审核必须走「申请 → 经理批准」流；直接反审核仅经理/admin 可执行(防绕过)
        if (!await svc.IsManagerAsync(CurrentUser))
            return Conflict(new { 消息 = "BOM反审核需先提交申请，由经理在消息中心批准后生效。" });
        try { await svc.BomSetAuditAsync(款号, false, CurrentUser); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "反审核", $"款号={款号}");
        return NoContent();
    }

    // —— BOM 反审核申请-审批流：申请(反审核权限) → 经理同意/拒绝(消息中心) ——
    [HttpPost("{款号}/bom-reverse-audit-request")]
    public async Task<IActionResult> RequestBomReverseAudit(string 款号, [FromBody] BomReverseAuditRequestDto dto)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await svc.RequestBomReverseAuditAsync(款号, dto.原因, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "申请反审核", $"款号={款号}");
        return NoContent();
    }

    [HttpPost("{款号}/bom-reverse-audit-request/approve")]
    public async Task<IActionResult> ApproveBomReverseAuditRequest(string 款号)
    {
        try { await svc.ApproveBomReverseAuditRequestAsync(款号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "反审核", $"款号={款号}(经理批准申请)");
        return NoContent();
    }

    [HttpPost("{款号}/bom-reverse-audit-request/reject")]
    public async Task<IActionResult> RejectBomReverseAuditRequest(string 款号)
    {
        try { await svc.RejectBomReverseAuditRequestAsync(款号, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("款号物料总表", "拒绝反审核", $"款号={款号}");
        return NoContent();
    }

    [HttpPost("{款号}/audit")]
    public async Task<IActionResult> AuditMaterials(string 款号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await svc.SetAuditAsync(款号, true, CurrentUser); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("不存在"))
        { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("半成品共用物料设置", "审核", $"产品货号={款号}");
        return NoContent();
    }

    [HttpPost("{款号}/reverse-audit")]
    public async Task<IActionResult> ReverseAuditMaterials(string 款号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await svc.SetAuditAsync(款号, false, CurrentUser); }
        catch (InvalidOperationException ex) when (ex.Message.Contains("不存在"))
        { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex)
        { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("半成品共用物料设置", "反审核", $"产品货号={款号}");
        return NoContent();
    }

    [HttpPut("{款号}/sizes")]
    public async Task<IActionResult> PutSizes(string 款号, [FromBody] List<string> sizes)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.ReplaceSizesAsync(款号, sizes); }
        catch (InvalidOperationException ex) { return NotFound(new { 消息 = ex.Message }); }
        await AuditAsync("款号尺码表", "修改", $"款号={款号}");
        return NoContent();
    }
}
