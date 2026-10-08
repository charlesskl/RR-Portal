using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品盘点查询：对 半成品盘点单/明细单 的汇总与明细报表。系统/盘点/盈亏列为 real，CAST decimal 对齐。日期 datetime2。
public sealed class SemiStocktakeQueryService(ISqlConnectionFactory factory)
{
    private static string FieldExpr(string? f) => f switch
    {
        "产品名称" => "d.[名称]",
        "配件编号" => "d.[物料编号]",
        "客户" => "d.[客户]",
        "产品货号" => "d.[货号]",
        _ => "d.[物料名称]"   // 默认 产品装配名称
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp) Common(SemiStocktakeQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date.AddDays(1).AddSeconds(-1);
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        return (start, end, kw, match, q.Exact ? "=" : "LIKE");
    }

    public async Task<IReadOnlyList<SemiStocktakeQuerySummaryRow>> SummaryAsync(SemiStocktakeQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var goodsGrp = q.MaterialOnly ? "" : ", d.[货号]";
        var goodsSel = q.MaterialOnly ? "MAX(d.[货号])" : "d.[货号]";
        var sql = $@"
SELECT d.[物料编号] AS [配件编号], {goodsSel} AS [产品货号], MAX(d.[名称]) AS [产品名称], MAX(d.[物料名称]) AS [产品装配名称],
       SUM(CAST(d.[系统数量] AS decimal(18,4))) AS [系统数], SUM(CAST(d.[盘点数量] AS decimal(18,4))) AS [盘点数], SUM(CAST(d.[盈亏数量] AS decimal(18,4))) AS [盈亏数]
FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@kw IS NULL OR {field} {cmp} @match)
GROUP BY d.[物料编号]{goodsGrp}
ORDER BY MAX(d.[货号]), d.[物料编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiStocktakeQuerySummaryRow>(sql, new { start, end, kw, match })).AsList();
    }

    public async Task<IReadOnlyList<SemiStocktakeQueryDetailRow>> DetailAsync(SemiStocktakeQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT h.[日期], h.[单号] AS [单号], d.[物料编号] AS [配件编号], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[物料名称] AS [产品装配名称],
       CAST(d.[系统数量] AS decimal(18,4)) AS [系统数量], CAST(d.[盘点数量] AS decimal(18,4)) AS [盘点数量], CAST(d.[盈亏数量] AS decimal(18,4)) AS [盈亏数量],
       d.[备注], ISNULL(h.[审核],'0') AS [审核]
FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
  AND (@kw IS NULL OR {field} {cmp} @match)
ORDER BY h.[日期], h.[单号], d.[ID];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiStocktakeQueryDetailRow>(sql, new { start, end, kw, match, audit })).AsList();
    }
}
