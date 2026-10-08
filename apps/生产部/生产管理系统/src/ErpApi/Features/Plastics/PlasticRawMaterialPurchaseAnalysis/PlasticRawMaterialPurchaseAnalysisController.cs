using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseAnalysis;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-purchase-analysis")]
public sealed class PlasticRawMaterialPurchaseAnalysisController(
    PlasticRawMaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料采购分析表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "物料类别")] string? 物料类别 = null,
        string? keyword = null, bool onlyBuy = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.PurchaseAnalysisAsync(物料类别, keyword, onlyBuy));
    }
}
