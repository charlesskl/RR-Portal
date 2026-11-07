using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using ErpApi.Features.Plastics;
using ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;
using ErpApi.Engines.Inventory;
namespace ErpApi.Engines.Posting;

public sealed class PostingEngine(ISqlConnectionFactory factory, IAuditLogger audit) : IPostingEngine
{
    public Task<bool> ApproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "0", to: "1", behavior: "审核");

    public Task<bool> UnapproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "1", to: "0", behavior: "反审核");

    private async Task<bool> SetAuditAsync(string table, string docNo, string user,
        string from, string to, string behavior)
    {
        if (!PostableDocuments.IsAllowed(table))
            throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");
        var docNoCol = PostableDocuments.DocNoColumn(table);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // Only raw-material/SP workflows opt into these guards; other document posting stays unchanged.
        if (table == "原料采购订单")
        {
            await RawMaterialProcurementPolicy.LockPurchaseAsync(c, tx, docNo);
            await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [原料采购订单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@docNo", new { docNo }, tx);
            await RawMaterialProcurementPolicy.RequirePermissionAsync(c, tx, user, to == "1" ? PermissionAction.审核 : PermissionAction.反审核);
            var state = await c.QuerySingleOrDefaultAsync<(string? Audit, string? Supervisor, string? Manager)>("SELECT [审核] AS Audit,[主管审核] AS Supervisor,[经理审核] AS Manager FROM [原料采购订单] WHERE [单号]=@docNo", new { docNo }, tx);
            if (to == "1" && state.Audit != "1" && (state.Supervisor != "1" || state.Manager != "1")) throw new InvalidOperationException("请先经主管、经理审核。");
            if (to == "1") await RawMaterialProcurementPolicy.ValidateForApprovalAsync(c, tx, docNo);
        }
        await RawMaterialInventorySql.LockDocumentAsync(c, tx, table, docNo);
        if (table == "原料入仓单") await RawMaterialReceiptPolicy.PreparePostingAsync(c, tx, docNo, user, to == "1");
        if (table == "原料出库单") await PlasticRawMaterialIssueApprovalService.EnsureFinalPostingAsync(c, tx, docNo, user, to == "1");
        if (table == "塑胶采购订单")
        {
            await RawMaterialSourceLock.LockDocumentAsync(c, tx, docNo);
            var rawVersion = await c.ExecuteScalarAsync<int?>("SELECT [原料扣减版本] FROM [塑胶采购订单] WHERE [单号]=@docNo", new { docNo }, tx);
            if (rawVersion is not null)
            {
                await RawMaterialTransactionPermissions.RequireAsync(c, tx, user, "塑胶采购订单", to == "1" ? PermissionAction.审核 : PermissionAction.反审核);
                var ready = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [塑胶采购订单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@docNo AND ([审核]=N'1' OR ([主管审核]=N'1' AND [经理审核]=N'1'))",new {docNo},tx);
                if (to == "1" && ready == 0) throw new InvalidOperationException("请先经主管、经理审核。");
            }
            if (to == "0") await PlasticRawIssueStockPolicy.EnsureOrderHasNoIssuesAsync(c, tx, docNo);
        }
        await RawMaterialInventorySql.ValidateSavedAsync(c, tx, table, docNo, from, to);


        // 表名/列名来自白名单，安全可拼接；单号/状态参数化。仅当当前状态=from 才翻转（幂等、防重复）
        var sql = $@"
UPDATE [{table}]
   SET [审核]=@to,
       [审核人]=CASE WHEN @to='1' THEN @user ELSE NULL END,
       [审核日期]=CASE WHEN @to='1' THEN SYSDATETIME() ELSE NULL END
 WHERE [{docNoCol}]=@docNo AND ISNULL([审核],'0')=@from;";
        var affected = await c.ExecuteAsync(sql, new { to, from, user, docNo }, tx);
        if (affected == 0) { tx.Rollback(); return false; }

        if (table == "原料出库单" && to == "0") await PlasticRawMaterialIssueApprovalService.ResetAfterUnapproveAsync(c, tx, docNo);
        await audit.WriteAsync(table, behavior, user, $"单号={docNo}", c, tx);
        tx.Commit();
        return true;
    }
}
