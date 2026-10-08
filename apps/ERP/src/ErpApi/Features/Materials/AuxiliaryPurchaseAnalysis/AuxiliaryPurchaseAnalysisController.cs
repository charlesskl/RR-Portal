using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Materials.MaterialMaster;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Materials.AuxiliaryPurchaseAnalysis;

[ApiController]
[Authorize]
[Route("api/auxiliary-purchase-analysis")]
public sealed class AuxiliaryPurchaseAnalysisController(
    MaterialMasterService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "物料资料";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery(Name = "物料类别")] string? 物料类别 = "辅料资料",
        string? keyword = null,
        bool onlyBuy = true)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.AuxiliaryPurchaseAnalysisAsync(物料类别, keyword, onlyBuy));
    }
}
