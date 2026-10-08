using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Production;

// 生产管理只读报表：BOM物料查询 / BOM货号查询 / 货号接单汇总表。全部 gate 在「生产制单·打开」。
[ApiController]
[Authorize]
[Route("api/production-reports")]
public sealed class ProductionReportController(
    ProductionReportService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "生产制单";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("bom-materials")]
    public async Task<IActionResult> BomMaterials(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.BomMaterialsAsync(keyword));
    }

    [HttpGet("bom-styles")]
    public async Task<IActionResult> BomStyles(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.BomStylesAsync(keyword));
    }

    // BOM 层级树:任一货号的上级链(MA货号)+子孙树(实单/半成品组成),参数 货号 必填
    [HttpGet("bom-tree")]
    public async Task<IActionResult> BomTree([FromQuery(Name = "货号")] string? 货号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(货号)) return BadRequest("缺少参数：货号");
        return Ok(await svc.BomTreeAsync(货号.Trim()));
    }

    [HttpGet("order-summary")]
    public async Task<IActionResult> OrderSummary(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrderSummaryAsync(keyword));
    }

    // 采购超数查询：每生产单×物料 已采购−BOM需求>0 列出超采
    [HttpGet("purchase-over")]
    public async Task<IActionResult> PurchaseOver(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.PurchaseOverAsync(keyword));
    }

    // 领料超数/欠领查询：每生产单×物料 差异=已领−BOM需求（负=欠领，正=超领），全部需求行
    [HttpGet("issue-over")]
    public async Task<IActionResult> IssueOver(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.IssueOverAsync(keyword));
    }

    // 制单用料查询：指定生产单 每物料 计划用量 对照 实际领料（审核领料单按生产单号汇总）
    [HttpGet("order-material-usage")]
    public async Task<IActionResult> OrderMaterialUsage([FromQuery(Name = "生产单号")] string? 生产单号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(生产单号)) return BadRequest("缺少参数：生产单号");
        return Ok(await svc.OrderMaterialUsageAsync(生产单号.Trim()));
    }

    // 采购领料分析表：生产单×物料 需求/采购/已领/库存 对照明细（差异=需求−已领）
    [HttpGet("purchase-issue-analysis")]
    public async Task<IActionResult> PurchaseIssueAnalysis(
        DateTime? 起 = null, DateTime? 止 = null, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.PurchaseIssueAnalysisAsync(起, 止, keyword));
    }

    // 采购分析明细查询：生产BOM物料清单（算法4）扁平明细
    [HttpGet("purchase-analysis")]
    public async Task<IActionResult> PurchaseAnalysis(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.PurchaseAnalysisAsync(keyword));
    }

    // 采购分析明细保存(详情页,可修改 需订数量/供应商):仅分析未审核可改(已审核先反审核)
    [HttpPut("purchase-analysis")]
    public async Task<IActionResult> UpdatePurchaseAnalysis([FromBody] PurchaseAnalysisSaveDto dto)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.保存)) return Forbid();
        try { return Ok(new { 更新行数 = await svc.UpdatePurchaseAnalysisAsync(dto) }); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    // 物料订单制作工作表：生产BOM物料清单 需订数量>0 的待订物料行（前端勾选→按生产单×供应商生成采购订单）
    [HttpGet("order-worksheet")]
    public async Task<IActionResult> OrderWorksheet(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrderWorksheetAsync(keyword));
    }

    // 生产单跟踪表：进度报表（计划/裁床/录入/未完成数 + 审核完成筛选）
    [HttpGet("tracking")]
    public async Task<IActionResult> Tracking(
        string? keyword = null,
        [FromQuery(Name = "审核")] string? 审核 = null,
        [FromQuery(Name = "完成")] string? 完成 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.TrackingAsync(keyword, 审核, 完成));
    }

    // 成品余料统计表：按款号 入仓累计 − 出仓累计 = 余数（菜单目录暂无独立权限菜单，与相邻报表同 gate 生产制单·打开）
    [HttpGet("finished-leftover")]
    public async Task<IActionResult> FinishedLeftover(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FinishedLeftoverAsync(keyword));
    }

    // 合同余料统计表：按(合同号 × 物料) 采购入仓 − BOM需求 = 余料
    [HttpGet("contract-leftover")]
    public async Task<IActionResult> ContractLeftover(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ContractLeftoverAsync(keyword));
    }

    // 生产加工缺料表：按(生产单 × 物料) 需求 − 库存 − 已领 = 缺料（仅缺料行）
    [HttpGet("process-shortage")]
    public async Task<IActionResult> ProcessShortage(string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProcessShortageAsync(keyword));
    }
}
