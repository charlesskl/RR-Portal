using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials.FactoryMaster;

[ApiController]
[Authorize]
[Route("api/factory-master")]
public sealed class FactoryMasterController(
    FactoryMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "加工厂资料";
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
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(类别, keyword, page, size));
    }
}
