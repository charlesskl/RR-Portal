using Dapper;
using ErpApi.Engines.Authorization;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

// 原料职责与全局菜单权限分离。只读取管理员明确保存的账号绑定，不按人名猜身份。
public sealed class RawMaterialActor
{
    public bool IsAdmin { get; init; }
    public bool IsManaged { get; init; }
    public bool IsValid { get; init; }
    public string? DepartmentCode { get; init; }
    public string? PositionCode { get; init; }
    public string? Warehouse { get; init; }
    public string Mode => IsManaged ? "direct" : "manual";
    public IReadOnlyDictionary<string, PermissionFlags> EffectivePermissions { get; init; } = new Dictionary<string, PermissionFlags>();
}

public static class RawMaterialActorAccess
{
    private sealed record Account(long ID, string User, DateTime? LockedUntil);
    private sealed record Assignment(string DepartmentCode, string PositionCode, string? Warehouse);
    public static readonly IReadOnlyDictionary<string, (string Department, string? Warehouse)> Roles =
        new Dictionary<string, (string, string?)>(StringComparer.Ordinal)
        {
            ["06-clerk"] = ("06", null), ["06-supervisor"] = ("06", null), ["06-manager"] = ("06", null),
            ["05-warehouse"] = ("05", "原料仓"), ["05-manager"] = ("05", null)
        };

    public static async Task<RawMaterialActor> ResolveAsync(SqlConnection c, SqlTransaction? tx, string user)
    {
        var hold = tx is null ? "" : "WITH(HOLDLOCK)";
        var accounts = (await c.QueryAsync<Account>($"SELECT [ID],[用户] AS [User],[锁定到期] AS LockedUntil FROM [sysfileuser] {hold} WHERE [用户]=@user", new { user }, tx)).ToArray();
        if (accounts.Length != 1 || accounts[0].LockedUntil > DateTime.Now) return new();
        var account = accounts[0];
        var permissions = await RawMaterialTransactionPermissions.ReadAsync(c, tx, account.User);
        var assigned = await c.QuerySingleOrDefaultAsync<Assignment>($"SELECT [部门编号] AS DepartmentCode,[岗位代码] AS PositionCode,[所属仓库] AS Warehouse FROM [原料流程岗位绑定] {hold} WHERE [用户ID]=@id", new { id = account.ID }, tx);
        var valid = assigned is null || (Roles.TryGetValue(assigned.PositionCode, out var role)
            && role.Department == assigned.DepartmentCode && role.Warehouse == assigned.Warehouse
            && await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM [部门信息] {hold} WHERE [编号]=@code", new { code = assigned.DepartmentCode }, tx) == 1);
        return new() { IsAdmin = account.User.Equals("admin", StringComparison.OrdinalIgnoreCase), IsManaged = assigned is not null,
            IsValid = valid, DepartmentCode = assigned?.DepartmentCode, PositionCode = assigned?.PositionCode,
            Warehouse = assigned?.Warehouse, EffectivePermissions = permissions };
    }
}

public enum RawMaterialApprovalDuty { Supervisor, Manager, Keeper, WarehouseExecution }
public static class RawMaterialApprovalPolicy
{
    public static bool CanAct(RawMaterialActor actor, string department, RawMaterialApprovalDuty duty)
        => actor.IsValid && (actor.IsAdmin || (actor.IsManaged && actor.DepartmentCode == department && (duty switch
        {
            RawMaterialApprovalDuty.Supervisor => actor.PositionCode is "06-supervisor" or "06-manager",
            RawMaterialApprovalDuty.Manager => actor.PositionCode == department + "-manager",
            RawMaterialApprovalDuty.Keeper => actor.PositionCode == "05-warehouse" && actor.Warehouse == "原料仓",
            RawMaterialApprovalDuty.WarehouseExecution => actor.PositionCode == "05-manager" || actor.PositionCode == "05-warehouse" && actor.Warehouse == "原料仓",
            _ => false
        })));

    public static async Task EnsureAsync(SqlConnection c, SqlTransaction? tx, string user, string department, RawMaterialApprovalDuty duty)
    {
        if (!CanAct(await RawMaterialActorAccess.ResolveAsync(c, tx, user), department, duty))
            throw new InvalidOperationException("当前账号未配置对应的原料流程岗位，不能执行此审核阶段。");
    }

    public static async Task<IReadOnlyList<string>> RecipientsAsync(SqlConnection c, SqlTransaction? tx,
        IEnumerable<string> legacyCandidates, string department, RawMaterialApprovalDuty duty, string? warehouse = null)
    {
        var users = await c.QueryAsync<string>("SELECT u.[用户] FROM [sysfileuser] u JOIN [原料流程岗位绑定] b ON b.[用户ID]=u.[ID] WHERE b.[部门编号]=@department ORDER BY u.[ID]", new { department }, tx);
        var result = new List<string>();
        foreach (var user in users)
        {
            var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
            if (actor.IsManaged && actor.IsValid && actor.PositionCode == "05-warehouse"
                && actor.Warehouse == warehouse && CanAct(actor, department, duty)) result.Add(user);
        }
        return result;
    }
}

// 此扩展只供原料链在已有业务事务中调用；不改变全局 PermissionService 的旧语义。
public static class RawMaterialTransactionPermissions
{
    private sealed record Row(string? 菜单, bool? 打开, bool? 保存, bool? 删除, bool? 打印, bool? 单价, bool? 金额, bool? 审核, bool? 反审核, bool? 功能);
    public static async Task<IReadOnlyDictionary<string, PermissionFlags>> ReadAsync(SqlConnection c, SqlTransaction? tx, string user)
    {
        var hold = tx is null ? "" : "WITH(HOLDLOCK)";
        var rows = await c.QueryAsync<Row>($"SELECT [菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能] FROM [userbqrpower] {hold} WHERE [用户]=@user", new { user }, tx);
        var map = new Dictionary<string, PermissionFlags>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            if (string.IsNullOrEmpty(r.菜单)) continue;
            map[r.菜单] = new() { 打开 = r.打开 ?? false, 保存 = r.保存 ?? false, 删除 = r.删除 ?? false,
                打印 = r.打印 ?? false, 单价 = r.单价 ?? false, 金额 = r.金额 ?? false, 审核 = r.审核 ?? false,
                反审核 = r.反审核 ?? false, 功能 = r.功能 ?? false };
        }
        return map;
    }

    public static async Task RequireAsync(SqlConnection c, SqlTransaction tx, string user, string menu, PermissionAction action)
    {
        var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
        if (!actor.IsValid || !actor.EffectivePermissions.TryGetValue(menu, out var p) || !p.打开 || !p.Has(action))
            throw new UnauthorizedAccessException($"当前账号没有 {menu} 的打开及 {action} 权限。");
    }

    public static async Task<bool> HasAsync(this IPermissionService permissions, SqlConnection c, SqlTransaction? tx,
        string user, string menu, PermissionAction action)
    {
        var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
        return actor.IsValid && actor.EffectivePermissions.TryGetValue(menu, out var p) && p.Has(action);
    }
}

public static class RawMaterialSourceLock
{
    public static async Task LockDocumentAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var result = await c.ExecuteScalarAsync<int>("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000; SELECT @r;", new { resource = "plastic-purchase:" + number.Trim().ToUpperInvariant() }, tx);
        if (result < 0) throw new InvalidOperationException("啤机来源单正在处理，请稍后重试。");
    }
}
