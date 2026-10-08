using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Finished;

// 成品入仓查询：对 成品入仓单/明细单(玩具模型) 的汇总与明细报表。明细自带产品列。日期 datetime。
public sealed class FinishedReceiptQueryService(ISqlConnectionFactory factory)
{
    private static string FieldExpr(string? f) => f switch
    {
        "产品名称" => "d.[名称]",
        "配件编号" => "d.[配件编号]",
        "客户" => "d.[客户]",
        "产品货号" => "d.[货号]",
        _ => "d.[产品装配名称]"   // 默认 产品装配名称
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp, string? cust) Common(FinishedReceiptQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date.AddDays(1).AddSeconds(-1);
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        var cust = string.IsNullOrWhiteSpace(q.客户) ? null : q.客户.Trim();
        return (start, end, kw, match, q.Exact ? "=" : "LIKE", cust);
    }

    public async Task<IReadOnlyList<FinishedReceiptQuerySummaryRow>> SummaryAsync(FinishedReceiptQueryDto q)
    {
        var (start, end, kw, match, cmp, cust) = Common(q);
        var field = FieldExpr(q.Field);
        var supplierGrp = q.BySupplier ? ", h.[供应商编号], h.[供应商名称]" : "";
        var supplierSel = q.BySupplier ? "h.[供应商编号] AS [供应商编号], h.[供应商名称] AS [供应商名称]," : "CAST(NULL AS nvarchar(80)) AS [供应商编号], CAST(NULL AS nvarchar(200)) AS [供应商名称],";
        var goodsGrp = q.MaterialOnly ? "" : ", d.[货号]";
        var goodsSel = q.MaterialOnly ? "MAX(d.[货号])" : "d.[货号]";
        var sql = $@"
SELECT d.[客户], d.[配件编号], {goodsSel} AS [产品货号], MAX(d.[名称]) AS [产品名称], MAX(d.[产品装配名称]) AS [产品装配名称],
       {supplierSel} SUM(ISNULL(d.[箱数],0)) AS [入仓箱数], SUM(d.[数量]) AS [入仓数量]
FROM [成品入仓明细单] d JOIN [成品入仓单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@cust IS NULL OR d.[客户]=@cust)
  AND (@kw IS NULL OR {field} {cmp} @match)
GROUP BY d.[客户], d.[配件编号]{goodsGrp}{supplierGrp}
ORDER BY d.[客户], MAX(d.[货号]), d.[配件编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<FinishedReceiptQuerySummaryRow>(sql, new { start, end, kw, match, cust })).AsList();
    }

    public async Task<IReadOnlyList<FinishedReceiptQueryDetailRow>> DetailAsync(FinishedReceiptQueryDto q)
    {
        var (start, end, kw, match, cmp, cust) = Common(q);
        var field = FieldExpr(q.Field);
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT h.[日期], h.[单号] AS [单号], h.[入库单号], h.[订单单号], h.[供应商编号], h.[供应商名称],
       d.[生产单号], d.[配件编号], d.[客户], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[产品装配名称],
       d.[箱数], d.[数量], d.[备注], ISNULL(h.[审核],'0') AS [审核]
FROM [成品入仓明细单] d JOIN [成品入仓单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@cust IS NULL OR d.[客户]=@cust)
  AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
  AND (@kw IS NULL OR {field} {cmp} @match)
ORDER BY h.[日期], h.[单号], d.[ID];";
        using var c = factory.Create();
        return (await c.QueryAsync<FinishedReceiptQueryDetailRow>(sql, new { start, end, kw, match, cust, audit })).AsList();
    }
}
