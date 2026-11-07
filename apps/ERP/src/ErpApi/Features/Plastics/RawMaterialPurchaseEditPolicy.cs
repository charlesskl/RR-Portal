using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Plastics;
internal static class RawMaterialPurchaseEditPolicy
{
    internal static async Task<string?> ReasonAsync(IDbConnection c, string table, string no, IDbTransaction? tx = null)
    {
        if (table != "原料采购订单") throw new ArgumentException("原料采购策略不接受其他单据。");
        var receipt = await c.ExecuteScalarAsync<string?>("SELECT TOP(1) h.[单号] FROM [原料入仓单] h JOIN [原料入仓明细单] d ON d.[单号]=h.[单号] WHERE h.[订单单号]=@no ORDER BY h.[ID]", new { no }, tx);
        return receipt is null ? null : $"已有关联原料入仓申请 {receipt}，请先处理并删除申请，再修改采购订单。";
    }
    internal static async Task EnsureMutableAsync(SqlConnection c, SqlTransaction tx, string table, string no)
    {
        var reason = await ReasonAsync(c, table, no, tx);
        if (reason is not null) throw new InvalidOperationException(reason);
    }
    internal static Task ResetApprovalAsync(SqlConnection c, SqlTransaction tx, string table, string no)
    {
        if (table != "原料采购订单") throw new ArgumentException("原料采购策略不接受其他单据。");
        return c.ExecuteAsync("UPDATE [原料采购订单] SET [审核]=N'0',[审核人]=NULL,[审核日期]=NULL,[主管审核]=N'0',[主管审核人]=NULL,[主管审核日期]=NULL,[经理审核]=N'0',[经理审核人]=NULL,[经理审核日期]=NULL WHERE [单号]=@no", new { no }, tx);
    }
    internal static string PriceKey(params string?[] parts)
        => string.Join('\u001f', parts.Select(x => x?.Trim().ToUpperInvariant() ?? ""));

    // 无价账号只可沿用原来可唯一确认的价格，不能以界面的 null 或伪造值冲掉真实单价。
    internal static void PreservePrices<T>(IEnumerable<(string Key, decimal? Price)> original,
        IEnumerable<T> changes, Func<T, string> key, Action<T, decimal?> setPrice)
    {
        var prices = original.GroupBy(x => x.Key).ToDictionary(g => g.Key, g => g.Select(x => x.Price).Distinct().ToArray());
        foreach (var line in changes)
        {
            if (!prices.TryGetValue(key(line), out var values) || values.Length != 1)
                throw new InvalidOperationException("无单价权限不能新增、替换或修改无法唯一确定原价的采购明细，请由有单价权限的人员处理。");
            setPrice(line, values[0]);
        }
    }
}
