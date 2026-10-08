using System.Reflection;
using System.Security.Claims;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.MasterData;

[ApiController]
[Authorize]
public abstract class MasterCrudController<T>(
    MasterCrudService<T> svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
    where T : MasterEntity
{
    protected abstract string Menu { get; }
    protected abstract string TableName { get; }

    // 保存前挂钩(可选重写):做录入规范化(如编号大写)与业务校验;返回中文错误信息则 400,null=通过。
    protected virtual string? ValidateForSave(T entity) => null;

    // 保存前异步挂钩(可选重写):需要查库的校验(如字典存在性)挂这里;默认回落到同步挂钩。
    protected virtual Task<string?> ValidateForSaveAsync(T entity) => Task.FromResult(ValidateForSave(entity));

    // 供子类异步校验挂钩查库用(基类本身已捕获 factory,不再让子类重复捕获)
    protected ISqlConnectionFactory Factory => factory;

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    // 标了 [PriceField] 的价格/成本属性(每个封闭泛型 T 只反射一次)
    private static readonly PropertyInfo[] PriceProps =
        typeof(T).GetProperties().Where(p => p.IsDefined(typeof(PriceFieldAttribute), false)).ToArray();

    // 成本保密:无"单价"权限时把价格字段置空后再返回(后端落实,不只前端隐藏)
    private async Task MaskPricesAsync(IEnumerable<T> items)
    {
        if (PriceProps.Length == 0) return;
        if (await AllowAsync(PermissionAction.单价)) return;
        foreach (var item in items)
            foreach (var p in PriceProps)
                p.SetValue(item, null);
    }

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(TableName, behavior, CurrentUser, record, c);
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        await MaskPricesAsync(result.Items);
        return Ok(result);
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var e = await svc.GetAsync(id);
        if (e is null) return NotFound();
        await MaskPricesAsync(new[] { e });
        return Ok(e);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] T entity)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        // 无"单价"权限者新增:按 [PriceField] 策略剥离价格字段(与 Update 从库回填保护同源,防止借新增写入价格)
        if (PriceProps.Length > 0 && !await AllowAsync(PermissionAction.单价))
            foreach (var p in PriceProps) p.SetValue(entity, null);
        var err = await ValidateForSaveAsync(entity);
        if (err is not null) return BadRequest(new { 消息 = err });
        T created;
        try
        {
            created = await svc.CreateAsync(entity);
        }
        // 唯一索引兜底(与 Update 同源:EF 把 SqlException 包成 DbUpdateException),转 409 中文提示而非原始 500
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return Conflict(new { 消息 = "保存失败：编号已存在（唯一性冲突）" });
        }
        // 外键兜底(547,如引用的供应商/字典不存在):转 409 中文提示而非原始 500
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 547 })
        {
            return Conflict(new { 消息 = "保存失败：引用的基础资料不存在（外键冲突）" });
        }
        await AuditAsync("新增", $"ID={created.ID}");
        return CreatedAtAction(nameof(Get), new { id = created.ID }, created);
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] T entity)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        // 路由 id 为准：表单体一般不带 ID(=0)，唯一性校验(如 物料编号 已存在 排除自身)依赖 e.ID，先回填
        entity.ID = id;
        // 无"单价"权限者编辑:价格字段读取时被脱敏为 null，整实体覆盖会抹掉真实价格——从库回填原值保护
        if (PriceProps.Length > 0 && !await AllowAsync(PermissionAction.单价))
        {
            var existing = await svc.GetAsync(id);
            if (existing is null) return NotFound();
            foreach (var p in PriceProps) p.SetValue(entity, p.GetValue(existing));
        }
        var err = await ValidateForSaveAsync(entity);
        if (err is not null) return BadRequest(new { 消息 = err });
        try
        {
            if (!await svc.UpdateAsync(id, entity)) return NotFound();
        }
        // 唯一索引兜底(如 工模表 改名撞 UX_工模表_工模编号):EF 把 SqlException 包成 DbUpdateException
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return Conflict(new { 消息 = "保存失败：编号已存在（唯一性冲突）" });
        }
        // 外键兜底(547,如引用的供应商/字典不存在):转 409 中文提示而非原始 500
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 547 })
        {
            return Conflict(new { 消息 = "保存失败：引用的基础资料不存在（外键冲突）" });
        }
        await AuditAsync("修改", $"ID={id}");
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await svc.DeleteAsync(id)) return NotFound();
        }
        // 外键引用冲突(547,如客户被业务单据引用):转 409 中文提示而非原始 500
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 547 })
        {
            return Conflict(new { 消息 = "该数据已被引用，不可删除" });
        }
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}
