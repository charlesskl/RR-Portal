using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

[ApiController]
[Authorize]
[Route("api/plastic-common-materials")]
public sealed class PlasticCommonMaterialController(
    PlasticCommonMaterialService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶共用物料表";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(
        string? 客户 = null, string? 塑胶货号 = null, string? 工模编号 = null,
        string? keyword = null, string? 审核情况 = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(客户, 塑胶货号, 工模编号, keyword, 审核情况, page, size);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items)
            {
                r.加工单价 = null; r.啤机价钱 = null; r.胶件啤工价 = null;
                r.胶料单价 = null; r.原胶料单价 = null; r.加工总单价 = null; r.其它成本 = null;
            }
        return Ok(result);
    }
}
