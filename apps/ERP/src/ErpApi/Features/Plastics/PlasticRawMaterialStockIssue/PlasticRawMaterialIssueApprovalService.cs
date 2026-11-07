using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

// 啤机部门批准申请后交原料仓执行；批准、通知和审计必须同事务。
public sealed class PlasticRawMaterialIssueApprovalService(
    ISqlConnectionFactory factory, IPermissionService permissions, IAuditLogger audit)
{
    public const string MessageType = "原料领料待出库";
    private const string Menu = "原料出库表";
    private sealed record Stage(string? 主管审核, string? 经理审核, string? 审核);

    public Task SupervisorApproveAsync(string number, string user) => ApproveAsync(number, user, manager: false);
    public Task ManagerApproveAsync(string number, string user) => ApproveAsync(number, user, manager: true);

    private async Task ApproveAsync(string number, string user, bool manager)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // 与保存、删除及最终过账保持原料→来源→账号→单头的同一锁顺序。
        await RawMaterialInventorySql.LockDocumentAsync(c, tx, "原料出库单", number);
        await EnsureActorAsync(c, tx, user, manager);
        var stage = await c.QuerySingleOrDefaultAsync<Stage>(@"SELECT [主管审核],[经理审核],[审核]
FROM [原料出库单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number", new { number }, tx);
        if (stage is null) throw new KeyNotFoundException($"原料出库单 {number} 不存在。");
        if (stage.审核 == "1" || (manager ? stage.经理审核 : stage.主管审核) == "1")
            throw new InvalidOperationException("该领料单已完成本阶段审核，请重新打开核对。");
        if (manager && stage.主管审核 != "1")
            throw new InvalidOperationException("请先经啤机部主管审核，再由经理审核。");
        IReadOnlyList<string> recipients = [];
        if (manager)
        {
            var candidates = await RawMaterialApprovalPolicy.RecipientsAsync(c, tx, [], "05", RawMaterialApprovalDuty.Keeper, "原料仓");
            var valid = new List<string>();
            foreach (var candidate in candidates)
            {
                // 必须共用当前连接/事务；另开权限连接会与账号心跳形成锁队列环。
                if (await permissions.HasAsync(c, tx, candidate, Menu, PermissionAction.打开)
                    && await permissions.HasAsync(c, tx, candidate, Menu, PermissionAction.审核)) valid.Add(candidate);
            }
            recipients = valid;
            if (recipients.Count == 0)
                throw new InvalidOperationException("未找到有权接收的原料仓负责人，请管理员配置原料仓仓管岗位后重试。");
        }
        var prefix = manager ? "经理" : "主管";
        await c.ExecuteAsync($@"UPDATE [原料出库单] SET [{prefix}审核]=N'1',[{prefix}审核人]=@user,[{prefix}审核日期]=SYSDATETIME()
WHERE [单号]=@number", new { number, user }, tx);
        if (manager)
            await MessageService.SendAsync(c, tx, recipients, MessageType, number, "原料领料单待出库",
                $"原料领料单 {number} 已经啤机部主管、经理审核，请原料仓核对实领数量后确认出库。",
                once: false); // 仅0→1阶段转换发送；反审重走是一轮新的待办，旧消息不阻止重发。
        await audit.WriteAsync("原料出库单", prefix + "审核", user, $"单号={number}", c, tx);
        tx.Commit();
    }

    private async Task EnsureActorAsync(SqlConnection c, SqlTransaction tx, string user, bool manager)
    {
        await LockActorPermissionsAsync(c, tx, user);
        var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
        if (!await permissions.HasAsync(c, tx, user, Menu, PermissionAction.打开)
            || !await permissions.HasAsync(c, tx, user, Menu, PermissionAction.审核))
            throw new InvalidOperationException("当前账号没有原料领料打开及审核权限。");
        await RawMaterialApprovalPolicy.EnsureAsync(c, tx, user, "06",
            manager ? RawMaterialApprovalDuty.Manager : RawMaterialApprovalDuty.Supervisor);
    }

    public static Task ResetAfterUnapproveAsync(SqlConnection c, SqlTransaction tx, string number)
        => c.ExecuteAsync(@"UPDATE [原料出库单]
SET [主管审核]=N'0',[主管审核人]=NULL,[主管审核日期]=NULL,
    [经理审核]=N'0',[经理审核人]=NULL,[经理审核日期]=NULL
WHERE [单号]=@number AND ISNULL([审核],N'0')<>N'1'", new { number }, tx);

    // 调用方已按原料→来源加锁；账号/权限先于单头。审批前置对admin同样生效。
    public static async Task EnsureFinalPostingAsync(SqlConnection c, SqlTransaction tx, string number, string user, bool approved)
    {
        await LockActorPermissionsAsync(c, tx, user);
        var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
        var action = approved ? PermissionAction.审核 : PermissionAction.反审核;
        if (!actor.IsValid || !actor.EffectivePermissions.TryGetValue(Menu, out var permission)
            || !permission.打开 || !permission.Has(action))
            throw new InvalidOperationException("当前账号没有原料领料打开及" + (approved ? "审核" : "反审核") + "权限。");
        var duty = approved ? RawMaterialApprovalDuty.WarehouseExecution : RawMaterialApprovalDuty.Manager;
        if (!RawMaterialApprovalPolicy.CanAct(actor, "05", duty))
            throw new InvalidOperationException(approved ? "须由明确配置的原料仓岗位确认出库。" : "须由明确配置的仓务部经理反审核原料出库。");
        var stage = await c.QuerySingleOrDefaultAsync<Stage>(@"SELECT [主管审核],[经理审核],[审核]
FROM [原料出库单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number", new { number }, tx);
        // 已审历史单不回填阶段；重复审核仍由过账状态判断返回false，反审也不要求历史阶段。
        if (approved && stage is not null && stage.审核 != "1" && (stage.主管审核 != "1" || stage.经理审核 != "1"))
            throw new InvalidOperationException("请先完成啤机部主管、经理审核，再确认原料出库。");
    }

    public static async Task LockActorPermissionsAsync(SqlConnection c, SqlTransaction tx, string user)
    {
        // 手工矩阵也保持到提交，避免已读通过后撤权但业务事务继续提交。
        var accounts = (await c.QueryAsync<DateTime?>("SELECT [锁定到期] FROM [sysfileuser] WITH(HOLDLOCK) WHERE [用户]=@user", new { user }, tx)).ToArray();
        if (accounts.Length != 1 || accounts[0] > DateTime.Now)
            throw new InvalidOperationException("当前原料领料操作账号不存在、重复或已停用。");
        await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [userbqrpower] WITH(HOLDLOCK) WHERE [用户]=@user AND [菜单]=@Menu", new { user, Menu }, tx);
    }
}
