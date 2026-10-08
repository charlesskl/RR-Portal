using System.Security.Claims;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

[ApiController]
[Authorize]
[Route("api/plastic-material-master")]
public sealed class PlasticMaterialMasterController(
    PlasticMaterialMasterService svc, IPermissionService perms,
    MasterCrudService<塑胶物料资料> crud, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "塑胶物料资料";
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
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false, bool 含子级 = false, string? 款号 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock, 含子级, 款号);
        // 无"单价"权限:全部价格字段脱敏置 null(与实体 [PriceField] 口径一致)
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items)
            {
                r.单价 = null; r.销售价 = null; r.加工总单价 = null; r.二次加工价 = null;
                r.啤机价钱 = null; r.胶件啤工价 = null; r.原料单价 = null; r.胶件料价 = null; r.其他成本 = null;
            }
        return Ok(result);
    }

    // Excel 导入:前端解析/打包备注后的行批量入库(编号已存在跳过,非法行记入失败明细)
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] PlasticMaterialImportRequest req)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var result = await svc.ImportAsync(req.Rows);
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Menu, "导入", CurrentUser,
            $"新增={result.新增},跳过={result.跳过},失败={result.失败}", c);
        return Ok(result);
    }
}
