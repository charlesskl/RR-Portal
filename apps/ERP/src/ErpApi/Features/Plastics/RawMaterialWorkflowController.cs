using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

public sealed record RawWorkflowRoleDto(string? PositionCode);

[ApiController, Authorize]
public sealed class RawMaterialWorkflowController(ISqlConnectionFactory factory, IPermissionService permissions, IAuditLogger audit) : ControllerBase
{
    private string UserName => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private sealed record Account(long ID, string User, DateTime? LockedUntil);

    [HttpGet("api/admin/accounts/{user}/raw-workflow-role")]
    public async Task<IActionResult> Role(string user)
    {
        using var c = factory.Create();
        if (!await permissions.HasAsync(c, null, UserName, "账号管理", PermissionAction.打开)) return Forbid();
        var accounts = (await c.QueryAsync<Account>("SELECT [ID],[用户] AS [User],[锁定到期] AS LockedUntil FROM [sysfileuser] WHERE [用户]=@user", new { user })).ToArray();
        if (accounts.Length != 1) return NotFound(new { 消息 = "账号不存在或不唯一。" });
        var actor = await RawMaterialActorAccess.ResolveAsync(c, null, accounts[0].User);
        return Ok(new { accountName = accounts[0].User, departmentCode = actor.DepartmentCode, positionCode = actor.PositionCode, warehouse = actor.Warehouse });
    }

    [HttpPut("api/admin/accounts/{user}/raw-workflow-role")]
    public async Task<IActionResult> SaveRole(string user, RawWorkflowRoleDto dto)
    {
        if (dto.PositionCode is not null && !RawMaterialActorAccess.Roles.ContainsKey(dto.PositionCode))
            return BadRequest(new { 消息 = "请选择有效的原料流程岗位，或清空以解除绑定。" });
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        if (!await permissions.HasAsync(c, tx, UserName, "账号管理", PermissionAction.打开)
            || !await permissions.HasAsync(c, tx, UserName, "账号管理", PermissionAction.保存)) return Forbid();
        var accounts = (await c.QueryAsync<Account>("SELECT [ID],[用户] AS [User],[锁定到期] AS LockedUntil FROM [sysfileuser] WITH(HOLDLOCK) WHERE [用户]=@user", new { user }, tx)).ToArray();
        if (accounts.Length != 1) return NotFound(new { 消息 = "目标账号不存在或不唯一。" });
        var account = accounts[0];
        if (dto.PositionCode is null)
            await c.ExecuteAsync("DELETE FROM [原料流程岗位绑定] WHERE [用户ID]=@id", new { id = account.ID }, tx);
        else
        {
            var role = RawMaterialActorAccess.Roles[dto.PositionCode];
            if (account.LockedUntil > DateTime.Now) return Conflict(new { 消息 = "目标账号已停用，请先核对账号。" });
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [部门信息] WITH(HOLDLOCK) WHERE [编号]=@department", new { department = role.Department }, tx) != 1)
                return Conflict(new { 消息 = "真实部门资料不存在或不唯一，不能绑定原料岗位。" });
            await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [原料流程岗位绑定] WITH(UPDLOCK,HOLDLOCK) WHERE [用户ID]=@id", new { id = account.ID }, tx);
            await c.ExecuteAsync("""
UPDATE [原料流程岗位绑定] SET [部门编号]=@department,[岗位代码]=@position,[所属仓库]=@warehouse,[更新人]=@actor,[更新时间]=SYSDATETIME() WHERE [用户ID]=@id;
IF @@ROWCOUNT=0 INSERT INTO [原料流程岗位绑定]([用户ID],[部门编号],[岗位代码],[所属仓库],[更新人],[更新时间]) VALUES(@id,@department,@position,@warehouse,@actor,SYSDATETIME());
""", new { id = account.ID, department = role.Department, position = dto.PositionCode, warehouse = role.Warehouse, actor = UserName }, tx);
        }
        await audit.WriteAsync("原料流程岗位绑定", dto.PositionCode is null ? "解除绑定" : "保存绑定", UserName,
            $"用户ID={account.ID};用户={account.User};岗位={dto.PositionCode ?? "未绑定"}", c, tx);
        tx.Commit();
        return NoContent();
    }

    [HttpGet("api/plastic-raw-material-stock-issue/access")]
    public async Task<IActionResult> Access()
    {
        using var c = factory.Create();
        var actor = await RawMaterialActorAccess.ResolveAsync(c, null, UserName);
        if (!actor.IsValid || !actor.EffectivePermissions.TryGetValue("原料出库表", out var p) || !p.打开) return Forbid();
        return Ok(new { isAdmin = actor.IsAdmin,
            canSupervisor = p.审核 && RawMaterialApprovalPolicy.CanAct(actor, "06", RawMaterialApprovalDuty.Supervisor),
            canManager = p.审核 && RawMaterialApprovalPolicy.CanAct(actor, "06", RawMaterialApprovalDuty.Manager),
            canWarehousePost = p.审核 && RawMaterialApprovalPolicy.CanAct(actor, "05", RawMaterialApprovalDuty.WarehouseExecution),
            canReverse = p.反审核 && RawMaterialApprovalPolicy.CanAct(actor, "05", RawMaterialApprovalDuty.Manager),
            departmentCode = actor.DepartmentCode, positionCode = actor.PositionCode, warehouse = actor.Warehouse });
    }

    [HttpGet("api/organization/raw-issue-maker-options")]
    public async Task<IActionResult> Makers(string? keyword = null)
    {
        using var c = factory.Create();
        if (!await permissions.HasAsync(c, null, UserName, "原料出库表", PermissionAction.打开)
            || !await permissions.HasAsync(c, null, UserName, "原料出库表", PermissionAction.保存)) return Forbid();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : "%" + keyword.Trim() + "%";
        var people = (await c.QueryAsync<Maker>("""
SELECT N'personnel' AS kind,N'personnel:'+CONVERT(nvarchar(30),p.[ID]) AS [key],p.[ID] AS personnelId,p.[编号] AS personnelNumber,p.[姓名] AS personnelName,
p.[部门编号] AS departmentCode,d.[部门] AS departmentName,p.[职称] AS positionName,p.[所属仓库] AS warehouse
FROM [人事档案] p JOIN [部门信息] d ON d.[编号]=p.[部门编号]
WHERE p.[在职]=N'在职' AND (p.[离职日期] IS NULL OR p.[离职日期]>SYSDATETIME())
AND (@kw IS NULL OR p.[编号] LIKE @kw OR p.[姓名] LIKE @kw) ORDER BY p.[编号],p.[ID]
""", new { kw })).ToList();
        var users = await c.QueryAsync<Account>("SELECT u.[ID],u.[用户] AS [User],u.[锁定到期] AS LockedUntil FROM [sysfileuser] u JOIN [原料流程岗位绑定] b ON b.[用户ID]=u.[ID] WHERE b.[部门编号]=N'06' AND (@kw IS NULL OR u.[用户] LIKE @kw) ORDER BY u.[ID]", new { kw });
        foreach (var user in users)
        {
            var actor = await RawMaterialActorAccess.ResolveAsync(c, null, user.User);
            if (!actor.IsValid || !actor.EffectivePermissions.TryGetValue("原料出库表", out var p) || !p.打开 || !p.保存) continue;
            people.Add(new() { kind = "account", key = "account:" + user.ID, accountName = user.User,
                personnelName = user.User, personnelNumber = "", departmentCode = "06", positionCode = actor.PositionCode, warehouse = actor.Warehouse });
        }
        return Ok(people);
    }

    public sealed class Maker
    {
        public string kind { get; set; } = "";
        public string key { get; set; } = "";
        public string? accountName { get; set; }
        public long? personnelId { get; set; }
        public string? personnelNumber { get; set; }
        public string? personnelName { get; set; }
        public string? departmentCode { get; set; }
        public string? departmentName { get; set; }
        public string? positionCode { get; set; }
        public string? positionName { get; set; }
        public string? warehouse { get; set; }
    }
}
