using Dapper;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

// 核算快照不等于实物领料。NULL 仅保留既有已审采购的历史自动扣料语义。
public static class PlasticRawIssueStockPolicy
{
    public const string IssueMode = "领料出库";

    private sealed class SourceState
    {
        public string? 审核 { get; set; }
        public bool 已自动扣库 { get; set; }
    }

    public static Task<string?> FindIssueAsync(SqlConnection c, SqlTransaction? tx, string number)
        => c.ExecuteScalarAsync<string?>(@"SELECT TOP(1) [单号] FROM [原料出库明细单]
WHERE [来源啤机采购单号]=@number OR LTRIM(RTRIM([啤机外发单号]))=@number OR LTRIM(RTRIM([啤机生产单号]))=@number ORDER BY [ID]",
            new { number = number.Trim() }, tx);

    public static async Task EnsureOrderHasNoIssuesAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var issue = await FindIssueAsync(c, tx, number);
        if (issue is not null)
            throw new InvalidOperationException($"塑胶采购单 {number} 已关联原料出库申请 {issue}，请先处理并删除该出库申请，不能修改、删除或反审核来源采购单。");
    }

    public static async Task LockIssueSourcesAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        foreach (var source in await ReadIssueSourcesAsync(c, tx, number))
            await RawMaterialSourceLock.LockDocumentAsync(c, tx, source);
    }

    public static async Task ValidateIssueSourcesAsync(SqlConnection c, SqlTransaction tx, string number, bool requireApproved)
    {
        foreach (var source in await ReadIssueSourcesAsync(c, tx, number))
        {
            var state = await c.QuerySingleOrDefaultAsync<SourceState>(@"SELECT h.[审核],CAST(CASE WHEN h.[审核]=N'1'
AND h.[原料扣减方式] IS NULL AND h.[原料扣减版本] IN(1,2)
AND EXISTS(SELECT 1 FROM [塑胶采购原料用量] s WHERE s.[采购单号]=h.[单号] AND s.[库存数量]>0)
THEN 1 ELSE 0 END AS bit) AS 已自动扣库
FROM [塑胶采购订单] h WITH(UPDLOCK,HOLDLOCK) WHERE h.[单号]=@source", new { source }, tx);
            // 没有真实 SP 来源的旧手工领料不按编号或备注猜单。
            if (state is null) continue;
            if (state.已自动扣库)
                throw new InvalidOperationException($"采购单 {source} 已按历史规则审核下发自动扣原料，不能再关联原料出库重复扣料。请先处理原采购单。");
            if (requireApproved && state.审核 != "1")
                throw new InvalidOperationException($"来源塑胶采购单 {source} 尚未审核下发，不能审核原料出库。");
        }
        await PlasticRawMaterialStockIssue.PlasticRawMaterialIssueSourcePolicy.ValidateSavedAsync(c, tx, number);
    }

    private static async Task<string[]> ReadIssueSourcesAsync(SqlConnection c, SqlTransaction tx, string number)
        => (await c.QueryAsync<string>(@"SELECT NULLIF(LTRIM(RTRIM([啤机外发单号])),N'') AS 来源 FROM [原料出库明细单] WHERE [单号]=@number
UNION SELECT NULLIF(LTRIM(RTRIM([啤机生产单号])),N'') FROM [原料出库明细单] WHERE [单号]=@number
UNION SELECT [来源啤机采购单号] FROM [原料出库明细单] WHERE [单号]=@number", new { number }, tx))
            .Where(x => !string.IsNullOrWhiteSpace(x)).Order(StringComparer.OrdinalIgnoreCase).ToArray();
}
