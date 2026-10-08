using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品报废查询：对 半成品报废单/明细单 的汇总与明细报表。明细自带产品列。日期为 date 型。
public sealed class SemiScrapQueryService(ISqlConnectionFactory factory)
{
    private static string FieldExpr(string? f) => f switch
    {
        "产品名称" => "d.[名称]",
        "配件编号" => "d.[物料编号]",
        "客户" => "d.[客户]",
        "产品货号" => "d.[货号]",
        _ => "d.[物料名称]"   // 默认 产品装配名称
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp) Common(SemiScrapQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date;
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        return (start, end, kw, match, q.Exact ? "=" : "LIKE");
    }

    public async Task<IReadOnlyList<SemiScrapSummaryRow>> SummaryAsync(SemiScrapQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var orderGrp = q.ByOrderNo ? ", d.[订单单号]" : "";
        var goodsGrp = q.MaterialOnly ? "" : ", d.[货号]";
        var goodsSel = q.MaterialOnly ? "MAX(d.[货号])" : "d.[货号]";
        var sql = $@"
SELECT d.[物料编号] AS [配件编号], {goodsSel} AS [产品货号], MAX(d.[名称]) AS [产品名称], MAX(d.[物料名称]) AS [产品装配名称],
       SUM(d.[数量]) AS [报废数量]
FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@kw IS NULL OR {field} {cmp} @match)
GROUP BY d.[物料编号]{goodsGrp}{orderGrp}
ORDER BY MAX(d.[货号]), d.[物料编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiScrapSummaryRow>(sql, new { start, end, kw, match })).AsList();
    }

    public async Task<IReadOnlyList<SemiScrapDetailRow>> DetailAsync(SemiScrapQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT h.[日期], h.[单号] AS [单号], h.[仓库], h.[部门] AS [报废部门], h.[报废人],
       d.[物料编号] AS [配件编号], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[物料名称] AS [产品装配名称],
       d.[数量], d.[备注], ISNULL(h.[审核],'0') AS [审核]
FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
  AND (@kw IS NULL OR {field} {cmp} @match)
ORDER BY h.[日期], h.[单号], d.[ID];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiScrapDetailRow>(sql, new { start, end, kw, match, audit })).AsList();
    }
}
