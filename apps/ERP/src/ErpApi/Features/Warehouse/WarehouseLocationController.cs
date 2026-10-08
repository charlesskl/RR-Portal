using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse;

// 仓库/仓位主数据(物料资料.仓位号 引用)。轻量 Dapper CRUD,自包含以免与并行任务争用 MasterData/Controllers.cs。
[ApiController]
[Authorize]
[Route("api/master/warehouse-locations")]
public sealed class WarehouseLocationController(
    ISqlConnectionFactory factory, IPermissionService perms, IAuditLogger audit) : ControllerBase
{
    private const string Menu = "仓库位置设置";
    private const string Table = "仓库位置";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var total = await c.ExecuteScalarAsync<int>(@"
SELECT COUNT(*) FROM [仓库位置]
WHERE @kw IS NULL OR [编号] LIKE @kw OR [名称] LIKE @kw OR [备注] LIKE @kw;", new { kw });
        var items = (await c.QueryAsync<WarehouseLocationRow>(@"
SELECT [ID],[编号],[名称],[备注] FROM [仓库位置]
WHERE @kw IS NULL OR [编号] LIKE @kw OR [名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] OFFSET @skip ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, skip = (page - 1) * size, size })).AsList();
        return Ok(new PagedResult<WarehouseLocationRow>(items, total));
    }

    // 单据表头「仓库」下拉选项:不限权限(登录即可),只暴露 编号/名称
    [HttpGet("options")]
    public async Task<IActionResult> Options()
    {
        using var c = factory.Create();
        var items = (await c.QueryAsync<WarehouseLocationRow>(
            "SELECT [ID],[编号],[名称],[备注] FROM [仓库位置] ORDER BY [编号];")).AsList();
        return Ok(items);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] WarehouseLocationRow dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var err = WarehouseLocationRules.校验(dto.编号, dto.名称);
        if (err is not null) return BadRequest(new { 消息 = err });
        using var c = factory.Create();
        try
        {
            dto.ID = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [仓库位置]([编号],[名称],[备注]) VALUES(@编号,@名称,@备注); SELECT SCOPE_IDENTITY();",
                new { 编号 = dto.编号!.Trim(), 名称 = dto.名称?.Trim(), 备注 = dto.备注?.Trim() });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        { return Conflict(new { 消息 = $"编号 {dto.编号} 已存在" }); }
        await AuditAsync("新增", $"编号={dto.编号}");
        return Ok(dto);
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] WarehouseLocationRow dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var err = WarehouseLocationRules.校验(dto.编号, dto.名称);
        if (err is not null) return BadRequest(new { 消息 = err });
        using var c = factory.Create();
        int n;
        try
        {
            n = await c.ExecuteAsync(@"
UPDATE [仓库位置] SET [编号]=@编号,[名称]=@名称,[备注]=@备注 WHERE [ID]=@id;",
                new { id, 编号 = dto.编号!.Trim(), 名称 = dto.名称?.Trim(), 备注 = dto.备注?.Trim() });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        { return Conflict(new { 消息 = $"编号 {dto.编号} 已存在" }); }
        if (n == 0) return NotFound();
        await AuditAsync("修改", $"ID={id}");
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        using var c = factory.Create();
        if (await c.ExecuteAsync("DELETE FROM [仓库位置] WHERE [ID]=@id", new { id }) == 0) return NotFound();
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}

public sealed class WarehouseLocationRow
{ public long ID { get; set; } public string? 编号 { get; set; } public string? 名称 { get; set; } public string? 备注 { get; set; } }

public static class WarehouseLocationRules
{
    // 返回中文错误信息则拒绝,null=通过
    public static string? 校验(string? 编号, string? 名称)
    {
        if (string.IsNullOrWhiteSpace(编号)) return "编号必填";
        if (编号.Trim().Length > 20) return "编号最长 20 字";
        if (名称 is not null && 名称.Trim().Length > 60) return "名称最长 60 字";
        return null;
    }
}
