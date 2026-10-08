using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi.Labels;

// 半成品标签查询：对 半成品标签单/明细 的汇总与明细报表。日期按单头，字段查询，明细可按审核过滤。
public sealed class SemiLabelQueryService(ISqlConnectionFactory factory)
{
    private static string FieldExpr(string? f, string alias) => f switch
    {
        "产品名称" => $"{alias}.[产品名称]",
        "配件编号" => $"{alias}.[配件编号]",
        "客户" => $"{alias}.[客户]",
        "产品装配名称" => $"{alias}.[产品装配名称]",
        _ => $"{alias}.[产品货号]"
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp) Common(SemiLabelQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date;
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        return (start, end, kw, match, q.Exact ? "=" : "LIKE");
    }

    public async Task<IReadOnlyList<SemiLabelSummaryRow>> SummaryAsync(SemiLabelQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field, "d");
        // 物料查询(共用物料)：仅按配件编号汇总；否则按 配件编号+产品货号 汇总
        var groupBy = q.MaterialOnly ? "d.[配件编号]" : "d.[配件编号], d.[产品货号]";
        var goodsSel = q.MaterialOnly ? "MAX(d.[产品货号])" : "d.[产品货号]";
        var sql = $@"
SELECT d.[配件编号], MAX(d.[客户]) AS [客户], {goodsSel} AS [产品货号],
       MAX(d.[产品名称]) AS [产品名称], MAX(d.[产品装配名称]) AS [产品装配名称],
       SUM(d.[数量]) AS [数量], MAX(d.[每箱数量]) AS [每箱数量],
       SUM(d.[预计标签数]) AS [预计标签数], SUM(d.[实需标签数]) AS [实需标签数]
FROM [半成品标签明细] d JOIN [半成品标签单] h ON h.[ID]=d.[标签单ID]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@kw IS NULL OR {field} {cmp} @match)
GROUP BY {groupBy}
ORDER BY MAX(d.[产品货号]), d.[配件编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiLabelSummaryRow>(sql, new { start, end, kw, match })).AsList();
    }

    public async Task<IReadOnlyList<SemiLabelDetailRow>> DetailAsync(SemiLabelQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field, "d");
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT h.[日期], h.[电脑单号] AS [单号], d.[配件编号], d.[客户], d.[产品货号], d.[产品名称], d.[产品装配名称],
       d.[数量], d.[每箱数量], d.[预计标签数], d.[实需标签数], d.[备注], h.[审核]
FROM [半成品标签明细] d JOIN [半成品标签单] h ON h.[ID]=d.[标签单ID]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
  AND (@kw IS NULL OR {field} {cmp} @match)
ORDER BY h.[日期] DESC, h.[电脑单号], d.[行号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiLabelDetailRow>(sql, new { start, end, kw, match, audit })).AsList();
    }
}
