using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticAnalysis;

[ApiController]
[Authorize]
[Route("api/plastic-analysis-detail")]
public sealed class PlasticAnalysisController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶分析明细查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null, [FromQuery(Name = "完成")] string? 完成 = null)
    {
        (起, 止) = QueryDateDefaults.Normalize(起, 止);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.AnalysisDetailAsync(起, 止, keyword, 完成);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.加工单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
