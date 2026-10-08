using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-master")]
public sealed class PlasticRawMaterialMasterController(
    PlasticRawMaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶原料资料表";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.CategoriesAsync());
    }

    [HttpGet]
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }
}
