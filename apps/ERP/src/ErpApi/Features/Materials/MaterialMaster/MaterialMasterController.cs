using System.Security.Claims;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.Materials.MaterialMaster;

[ApiController]
[Authorize]
[Route("api/material-master")]
public sealed class MaterialMasterController(
    MaterialMasterService svc, IPermissionService perms,
    MasterCrudService<物料资料> crud, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "物料资料";
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
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false, bool 含子级 = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock, 含子级);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }

    // 新增物料时预填的下一个编号（可改；保存时留空由 POST 兜底生成）
    [HttpGet("next-code")]
    public async Task<IActionResult> NextCode(string? 类别 = null)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        return Ok(new { 编号 = await svc.NextCodeAsync(类别) });
    }

    // 新增物料（编号为空自动生成）。编辑/删除仍走通用 /api/master/materials。
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] 物料资料 entity)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try
        {
            var created = await svc.CreateWithGeneratedCodeAsync(entity, crud);
            using var c = factory.Create();
            await c.OpenAsync();
            await audit.WriteAsync("物料资料", "新增", CurrentUser, $"ID={created.ID}", c);
            return Ok(created);
        }
        // 手输编号撞上 UQ_物料资料_物料编号(唯一索引兜底,前置校验在通用 CRUD 钩子);
        // EF 把 SqlException 包在 DbUpdateException 里
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return Conflict(new { 消息 = $"物料编号已存在：{entity.物料编号}" });
        }
    }

    // Excel 导入:前端解析/打包备注后的行批量入库(编号已存在跳过,非法行记入失败明细)
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] MaterialImportRequest req)
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
