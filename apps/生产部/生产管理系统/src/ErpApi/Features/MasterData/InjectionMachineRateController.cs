using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.MasterData;

// 啤机机型 + 啤工价主数据(工模表.啤机机型 引用)。轻量 Dapper CRUD,自包含以免与并行任务争用 Controllers.cs。
[ApiController]
[Authorize]
[Route("api/master/injection-machine-rates")]
public sealed class InjectionMachineRateController(
    ISqlConnectionFactory factory, IPermissionService perms, IAuditLogger audit) : ControllerBase
{
    private const string Menu = "啤机机型啤工表";
    private const string Table = "啤机机型啤工表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    // 成本保密:无"单价"权限时啤工价置空(与 MasterCrudController 的 PriceField 脱敏对齐)
    private async Task MaskAsync(IEnumerable<InjectionMachineRateRow> rows)
    {
        if (await AllowAsync(PermissionAction.单价)) return;
        foreach (var r in rows) r.啤工价 = null;
    }

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
SELECT COUNT(*) FROM [啤机机型啤工表]
WHERE @kw IS NULL OR [啤机机型] LIKE @kw OR [备注] LIKE @kw;", new { kw });
        var items = (await c.QueryAsync<InjectionMachineRateRow>(@"
SELECT [ID],[啤机机型],[啤工价],[备注] FROM [啤机机型啤工表]
WHERE @kw IS NULL OR [啤机机型] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] OFFSET @skip ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, skip = (page - 1) * size, size })).AsList();
        await MaskAsync(items);
        return Ok(new PagedResult<InjectionMachineRateRow>(items, total));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] InjectionMachineRateRow dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        if (dto.啤工价 is not null && !await AllowAsync(PermissionAction.单价))
            return StatusCode(403, new { 消息 = "无单价权限,不能录入啤工价" });
        var err = InjectionMachineRateRules.校验(dto.啤机机型, dto.啤工价);
        if (err is not null) return BadRequest(new { 消息 = err });
        using var c = factory.Create();
        try
        {
            dto.ID = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [啤机机型啤工表]([啤机机型],[啤工价],[备注]) VALUES(@机型,@价,@备注); SELECT SCOPE_IDENTITY();",
                new { 机型 = dto.啤机机型!.Trim(), 价 = dto.啤工价, 备注 = dto.备注?.Trim() });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        { return Conflict(new { 消息 = $"机型 {dto.啤机机型} 已存在" }); }
        await AuditAsync("新增", $"机型={dto.啤机机型}");
        await MaskAsync(new[] { dto });
        return Ok(dto);
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] InjectionMachineRateRow dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        // 无单价权限者编辑:整行覆盖会抹掉真实啤工价——回填库中原值保护(对齐 MasterCrudController)
        if (!await AllowAsync(PermissionAction.单价))
        {
            using var c0 = factory.Create();
            dto.啤工价 = await c0.ExecuteScalarAsync<decimal?>(
                "SELECT [啤工价] FROM [啤机机型啤工表] WHERE [ID]=@id", new { id });
        }
        var err = InjectionMachineRateRules.校验(dto.啤机机型, dto.啤工价);
        if (err is not null) return BadRequest(new { 消息 = err });
        using var c = factory.Create();
        int n;
        try
        {
            n = await c.ExecuteAsync(@"
UPDATE [啤机机型啤工表] SET [啤机机型]=@机型,[啤工价]=@价,[备注]=@备注 WHERE [ID]=@id;",
                new { id, 机型 = dto.啤机机型!.Trim(), 价 = dto.啤工价, 备注 = dto.备注?.Trim() });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        { return Conflict(new { 消息 = $"机型 {dto.啤机机型} 已存在" }); }
        if (n == 0) return NotFound();
        await AuditAsync("修改", $"ID={id}");
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        using var c = factory.Create();
        if (await c.ExecuteAsync("DELETE FROM [啤机机型啤工表] WHERE [ID]=@id", new { id }) == 0) return NotFound();
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}

public sealed class InjectionMachineRateRow
{ public long ID { get; set; } public string? 啤机机型 { get; set; } public decimal? 啤工价 { get; set; } public string? 备注 { get; set; } }

public static class InjectionMachineRateRules
{
    // 返回中文错误信息则拒绝,null=通过
    public static string? 校验(string? 机型, decimal? 啤工价)
    {
        if (string.IsNullOrWhiteSpace(机型)) return "啤机机型必填";
        if (机型.Trim().Length > 30) return "啤机机型最长 30 字";
        if (啤工价 is < 0) return "啤工价不能为负数";
        return null;
    }
}
