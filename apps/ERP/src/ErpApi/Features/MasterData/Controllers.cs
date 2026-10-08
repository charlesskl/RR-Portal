using Dapper;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
namespace ErpApi.Features.MasterData;

[Route("api/master/customer-categories")]
public sealed class CustomerCategoryController(
    MasterCrudService<客户类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<客户类别>(s, p, a, f)
{
    protected override string Menu => "客户类别";
    protected override string TableName => "客户类别";
}

[Route("api/master/customers")]
public sealed class CustomerController(
    MasterCrudService<客户资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<客户资料>(s, p, a, f)
{
    protected override string Menu => "客户资料";
    protected override string TableName => "客户资料";

    // 客户编号必填+唯一(库有 UQ_客户资料_客户编号 兜底,前置校验给中文提示);名称必填;超长按列宽前置拦截
    protected override async Task<string?> ValidateForSaveAsync(客户资料 e)
    {
        e.客户编号 = e.客户编号?.Trim();
        e.客户名称 = e.客户名称?.Trim();
        if (string.IsNullOrEmpty(e.客户编号)) return "客户编号不能为空";
        if (string.IsNullOrEmpty(e.客户名称)) return "客户名称不能为空";
        if (e.客户编号.Length > 20) return "客户编号最长 20 字";
        if (e.客户名称.Length > 50) return "客户名称最长 50 字";
        using var c = Factory.Create();
        var dup = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [客户资料] WHERE [客户编号]=@code AND [ID]<>@id;",
            new { code = e.客户编号, id = e.ID });
        return dup > 0 ? $"客户编号已存在：{e.客户编号}" : null;
    }
}

[Route("api/master/supplier-categories")]
public sealed class SupplierCategoryController(
    MasterCrudService<供应商类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<供应商类别>(s, p, a, f)
{ protected override string Menu => "供应商类别"; protected override string TableName => "供应商类别"; }

[Route("api/master/suppliers")]
public sealed class SupplierController(
    MasterCrudService<供应商资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<供应商资料>(s, p, a, f)
{ protected override string Menu => "供应商资料"; protected override string TableName => "供应商资料"; }

[Route("api/master/factory-categories")]
public sealed class FactoryCategoryController(
    MasterCrudService<加工厂类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<加工厂类别>(s, p, a, f)
{ protected override string Menu => "加工厂类别"; protected override string TableName => "加工厂类别"; }

[Route("api/master/factories")]
public sealed class FactoryController(
    MasterCrudService<加工厂资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<加工厂资料>(s, p, a, f)
{ protected override string Menu => "加工厂资料"; protected override string TableName => "加工厂资料"; }

[Route("api/master/material-categories")]
public sealed class MaterialCategoryController(
    MasterCrudService<物料类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<物料类别>(s, p, a, f)
{ protected override string Menu => "物料类别"; protected override string TableName => "物料类别"; }

[Route("api/master/materials")]
public sealed class MaterialController(
    MasterCrudService<物料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<物料资料>(s, p, a, f)
{
    protected override string Menu => "物料资料";
    protected override string TableName => "物料资料";
    // 物料编号全局唯一(库有 UQ_物料资料_物料编号 兜底,此处前置校验给中文提示)
    protected override async Task<string?> ValidateForSaveAsync(物料资料 e)
    {
        e.物料编号 = e.物料编号?.Trim();
        // 供应商编号有 FK→供应商资料(FK_135_查找):空串≠NULL,写库即撞 FK 报 500;
        // 空→null 放行,非空前置校验存在性给中文提示(与塑胶 工模编号 同套路)
        e.供应商编号 = string.IsNullOrWhiteSpace(e.供应商编号) ? null : e.供应商编号.Trim();
        if (string.IsNullOrEmpty(e.物料编号)) return "物料编号不能为空";
        using var c = Factory.Create();
        var dup = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [物料资料] WHERE [物料编号]=@code AND [ID]<>@id;",
            new { code = e.物料编号, id = e.ID });
        if (dup > 0) return $"物料编号已存在：{e.物料编号}";
        if (e.供应商编号 is not null)
        {
            var sup = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [供应商资料] WHERE [供应商编号]=@s;", new { s = e.供应商编号 });
            if (sup == 0) return $"供应商编号不存在：{e.供应商编号}";
        }
        return null;
    }
}

[Route("api/master/plastic-materials")]
public sealed class PlasticMaterialController(
    MasterCrudService<塑胶物料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶物料资料>(s, p, a, f)
{
    protected override string Menu => "塑胶物料资料";
    protected override string TableName => "塑胶物料资料";
    // 物料编号全局唯一(库有 UX_塑胶物料资料_物料编号 兜底,见 db/62,此处前置校验给中文提示)
    // 追加:工模编号非空须存在于工模表(复用塑胶共用物料的查库纯函数);套数=出模数÷用量(三值齐全才校验)
    protected override async Task<string?> ValidateForSaveAsync(塑胶物料资料 e)
    {
        e.物料编号 = e.物料编号?.Trim();
        e.工模编号 = e.工模编号?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(e.工模编号)) e.工模编号 = null;
        if (string.IsNullOrEmpty(e.物料编号)) return "物料编号不能为空";
        using var c = Factory.Create();
        var dup = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [塑胶物料资料] WHERE [物料编号]=@code AND [ID]<>@id;",
            new { code = e.物料编号, id = e.ID });
        if (dup > 0) return $"物料编号已存在：{e.物料编号}";
        var err = ErpApi.Features.Plastics.PlasticCommonMaterial.塑胶共用物料校验.校验套数(e.套数, e.出模数, e.用量);
        if (err is not null) return err;
        return await ErpApi.Features.Plastics.PlasticCommonMaterial.塑胶共用物料校验.校验工模编号存在(Factory, e.工模编号);
    }
}

[Route("api/master/plastic-material-categories")]
public sealed class PlasticMaterialCategoryController(
    MasterCrudService<塑胶物料类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶物料类别>(s, p, a, f)
{
    // 权限菜单直接复用"塑胶物料资料"(避免新增菜单权限种子;类别管理与物料同页同权)
    protected override string Menu => "塑胶物料资料";
    protected override string TableName => "塑胶物料类别";
}

[Route("api/master/plastic-raw-materials")]
public sealed class PlasticRawMaterialController(
    MasterCrudService<塑胶原料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶原料资料>(s, p, a, f)
{ protected override string Menu => "塑胶原料资料表"; protected override string TableName => "塑胶原料资料"; }

[Route("api/master/plastic-common-materials")]
public sealed class PlasticCommonMaterialController(
    MasterCrudService<塑胶共用物料表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶共用物料表>(s, p, a, f)
{
    protected override string Menu => "塑胶共用物料表";
    protected override string TableName => "塑胶共用物料表";
    // 旧说明书规则:套数 = 出模数 ÷ 用量(三值任一为空不校验)
    protected override string? ValidateForSave(塑胶共用物料表 e)
        => ErpApi.Features.Plastics.PlasticCommonMaterial.塑胶共用物料校验.校验套数(e.套数, e.出模数, e.用量);
    // 数据互通:四量校验之外,工模编号非空时须存在于工模表(需查库,挂异步钩子)
    protected override async Task<string?> ValidateForSaveAsync(塑胶共用物料表 e)
    {
        var err = ValidateForSave(e);
        if (err is not null) return err;
        return await ErpApi.Features.Plastics.PlasticCommonMaterial.塑胶共用物料校验.校验工模编号存在(Factory, e.工模编号);
    }
}

[Route("api/master/plastic-molds")]
public sealed class PlasticMoldController(
    MasterCrudService<工模表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<工模表>(s, p, a, f)
{
    protected override string Menu => "工模表";
    protected override string TableName => "工模表";
    // 录入规则:工模编号统一大写
    protected override string? ValidateForSave(工模表 e)
    {
        e.工模编号 = e.工模编号?.Trim().ToUpperInvariant();
        return null;
    }

    public sealed record MoldSyncCodeRequest(string? 旧编号, string? 新编号);
    public sealed record MoldSyncFieldsRequest(string? 工模编号);

    // 工模编号改名同步:单事务把引用方(塑胶物料资料/塑胶共用物料表)的工模编号从旧值改为新值。
    // 基类 AllowAsync/AuditAsync 是 private,此处直接用捕获的 p/a(与 PlasticMaterialMasterController 同款写法)。
    [HttpPost("sync-code")]
    public async Task<IActionResult> SyncCode([FromBody] MoldSyncCodeRequest req)
    {
        var user = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub") ?? "";
        if (!await p.HasAsync(user, Menu, PermissionAction.保存)) return Forbid();
        var oldCode = req.旧编号?.Trim().ToUpperInvariant();
        var newCode = req.新编号?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(oldCode) || string.IsNullOrEmpty(newCode))
            return BadRequest(new { 消息 = "旧编号/新编号不能为空" });
        if (oldCode == newCode) return Ok(new { 物料资料更新 = 0, 共用物料更新 = 0 });
        using var c = f.Create();
        await c.OpenAsync();
        int n1, n2;
        using (var tx = c.BeginTransaction())
        {
            n1 = await c.ExecuteAsync(
                "UPDATE [塑胶物料资料] SET [工模编号]=@newCode WHERE [工模编号]=@oldCode;",
                new { oldCode, newCode }, tx);
            n2 = await c.ExecuteAsync(
                "UPDATE [塑胶共用物料表] SET [工模编号]=@newCode WHERE [工模编号]=@oldCode;",
                new { oldCode, newCode }, tx);
            tx.Commit();
        }
        await a.WriteAsync(TableName, "修改", user,
            $"工模编号同步:{oldCode}→{newCode},物料资料={n1},共用物料={n2}", c);
        return Ok(new { 物料资料更新 = n1, 共用物料更新 = n2 });
    }

    // 工模技术字段同步:把工模表与塑胶物料资料的同名字段(及 原料单价←胶料单价)一次性 JOIN 更新。
    // 不同步 颜色/色粉号(说明书:一套模多色时由塑胶物料资料手动维护)/备注/客户/工模名称/整啤套数/手动字段。
    [HttpPost("sync-fields")]
    public async Task<IActionResult> SyncFields([FromBody] MoldSyncFieldsRequest req)
    {
        var user = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub") ?? "";
        if (!await p.HasAsync(user, Menu, PermissionAction.保存)) return Forbid();
        var code = req.工模编号?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(code)) return BadRequest(new { 消息 = "工模编号不能为空" });
        using var c = f.Create();
        await c.OpenAsync();
        var n = await c.ExecuteAsync(@"
UPDATE pm SET
    pm.[用料名称]=m.[用料名称], pm.[整啤模腔数]=m.[整啤模腔数], pm.[水口比例]=m.[水口比例],
    pm.[模具日产量]=m.[模具日产量], pm.[整啤毛重]=m.[整啤毛重], pm.[整啤净重]=m.[整啤净重],
    pm.[啤机机型]=m.[啤机机型], pm.[啤机价钱]=m.[啤机价钱], pm.[胶件啤工价]=m.[胶件啤工价],
    pm.[原胶料单价]=m.[原胶料单价], pm.[原料单价]=m.[胶料单价]
FROM [塑胶物料资料] pm
JOIN [工模表] m ON m.[工模编号]=pm.[工模编号]
WHERE pm.[工模编号]=@code;", new { code });
        await a.WriteAsync(TableName, "修改", user, $"工模字段同步:{code},物料资料={n}", c);
        return Ok(new { 物料资料更新 = n });
    }
}

[Route("api/master/departments")]
public sealed class DepartmentController(
    MasterCrudService<部门信息> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<部门信息>(s, p, a, f)
{ protected override string Menu => "部门信息"; protected override string TableName => "部门信息"; }

[Route("api/master/employees")]
public sealed class EmployeeController(
    MasterCrudService<人事档案> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<人事档案>(s, p, a, f)
{ protected override string Menu => "人事档案"; protected override string TableName => "人事档案"; }

[Route("api/master/quote-categories")]
public sealed class QuoteCategoryController(
    MasterCrudService<报价类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<报价类别>(s, p, a, f)
{ protected override string Menu => "报价类别"; protected override string TableName => "报价类别"; }

[Route("api/master/quotes")]
public sealed class QuoteController(
    MasterCrudService<报价资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<报价资料>(s, p, a, f)
{ protected override string Menu => "报价资料"; protected override string TableName => "报价资料"; }

[Route("api/master/price-adjusts")]
public sealed class PriceAdjustController(
    MasterCrudService<调价表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<调价表>(s, p, a, f)
{ protected override string Menu => "调价"; protected override string TableName => "调价表"; }

[Route("api/master/price-adjust-lines")]
public sealed class PriceAdjustLineController(
    MasterCrudService<调价明细> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<调价明细>(s, p, a, f)
{ protected override string Menu => "调价"; protected override string TableName => "调价明细表"; }

[Route("api/master/styles")]
public sealed class StyleMasterController(
    MasterCrudService<款号总表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号总表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号总表"; }

[Route("api/master/style-processes")]
public sealed class StyleProcessController(
    MasterCrudService<款号明细表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号明细表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号明细表"; }

[Route("api/master/style-bom-lines")]
public sealed class StyleBomLineController(
    MasterCrudService<款号物料明细表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号物料明细表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号物料明细表"; }

[Route("api/master/outsource-items")]
public sealed class OutsourceItemController(
    MasterCrudService<发外加工项目> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<发外加工项目>(s, p, a, f)
{ protected override string Menu => "发外加工项目"; protected override string TableName => "发外加工项目"; }
