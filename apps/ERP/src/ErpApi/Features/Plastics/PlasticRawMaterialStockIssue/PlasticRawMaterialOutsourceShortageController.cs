using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-outsource-shortage")]
public sealed class PlasticRawMaterialOutsourceShortageController(
    PlasticRawMaterialStockIssueService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料发外欠数表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery(Name = "供应商类别")] string? 供应商类别 = null,
        string? keyword = null,
        bool onlyOwed = true)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.OutsourceShortageAsync(供应商类别, keyword, onlyOwed));
    }
}
