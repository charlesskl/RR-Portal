using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品出库查询：对 半成品领料单/明细单 的汇总与明细报表，并并入 装配部领料单(仓库=半成品仓) 的出库行
// （领料备注固定「装配领料」，数量按已出口径：已出数量优先，未出但已审核=申请数量）。
// 装配采购=明细订单单号；领料备注/制单人=单头字段。本库无 审核日期 列，故明细不含该列。
public sealed class SemiIssueQueryService(ISqlConnectionFactory factory)
{
    // 关键字字段作用于 UNION 后的外层别名（两路明细列名不同）
    private static string FieldExpr(string? f) => f switch
    {
        "产品名称" => "t.[产品名称]",
        "配件编号" => "t.[配件编号]",
        "客户" => "t.[客户]",
        "产品货号" => "t.[产品货号]",
        _ => "t.[产品装配名称]"   // 默认 产品装配名称
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp) Common(SemiIssueQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date.AddDays(1).AddSeconds(-1);
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        return (start, end, kw, match, q.Exact ? "=" : "LIKE");
    }
    private static string? Norm(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    public async Task<IReadOnlyList<SemiIssueSummaryRow>> SummaryAsync(SemiIssueQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var remarkGrp = q.ByIssueRemark ? "t.[领料备注], " : "";
        var remarkSel = q.ByIssueRemark ? "t.[领料备注]" : "MAX(t.[领料备注])";
        var goodsGrp = q.MaterialOnly ? "" : ", t.[产品货号]";
        var goodsSel = q.MaterialOnly ? "MAX(t.[产品货号])" : "t.[产品货号]";
        var sql = $@"
SELECT {remarkSel} AS [领料备注], t.[装配采购], t.[配件编号], {goodsSel} AS [产品货号],
       MAX(t.[产品名称]) AS [产品名称], MAX(t.[产品装配名称]) AS [产品装配名称], SUM(t.[数量]) AS [领料数量], MAX(t.[备注]) AS [备注]
FROM (
    SELECT h.[领料备注], d.[订单单号] AS [装配采购], d.[物料编号] AS [配件编号], d.[货号] AS [产品货号],
           d.[名称] AS [产品名称], d.[物料名称] AS [产品装配名称], d.[数量], d.[备注], d.[客户]
      FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.[单号]=d.[单号]
     WHERE h.[日期] >= @start AND h.[日期] <= @end
       AND (@remark IS NULL OR h.[领料备注]=@remark)
    UNION ALL
    SELECT N'装配领料', NULL, d.[物料编号], d.[款号],
           CAST(NULL AS nvarchar(40)), d.[物料名称],
           (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END), d.[备注], CAST(NULL AS nvarchar(40))
      FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
     WHERE d.[仓库]=N'半成品仓' AND (ISNULL(d.[已出数量],0)>0 OR ISNULL(h.[审核],'0')='1')
       AND COALESCE(d.[日期],h.[日期]) >= @start AND COALESCE(d.[日期],h.[日期]) <= @end
       AND (@remark IS NULL OR N'装配领料'=@remark)
) t
WHERE (@kw IS NULL OR {field} {cmp} @match)
GROUP BY {remarkGrp}t.[装配采购], t.[配件编号]{goodsGrp}
ORDER BY t.[装配采购], MAX(t.[产品货号]), t.[配件编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiIssueSummaryRow>(sql, new { start, end, kw, match, remark = Norm(q.领料备注) })).AsList();
    }

    public async Task<IReadOnlyList<SemiIssueDetailRow>> DetailAsync(SemiIssueQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT t.[领料备注], t.[装配采购], t.[日期], t.[单号], t.[领料人], t.[生产单号],
       t.[配件编号], t.[产品货号], t.[产品名称], t.[产品装配名称],
       t.[数量], t.[备注], t.[制单人], t.[审核]
FROM (
    SELECT h.[领料备注], d.[订单单号] AS [装配采购], h.[日期], h.[单号], h.[领料人], d.[生产单号],
           d.[物料编号] AS [配件编号], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[物料名称] AS [产品装配名称],
           d.[数量], d.[备注], h.[制单人], ISNULL(h.[审核],'0') AS [审核], d.[客户]
      FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.[单号]=d.[单号]
     WHERE h.[日期] >= @start AND h.[日期] <= @end
       AND (@remark IS NULL OR h.[领料备注]=@remark)
       AND (@maker IS NULL OR h.[制单人]=@maker)
       AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
    UNION ALL
    SELECT N'装配领料', NULL, COALESCE(d.[日期],h.[日期]), h.[单号], h.[领料人], d.[生产单号],
           d.[物料编号], d.[款号], CAST(NULL AS nvarchar(40)), d.[物料名称],
           (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END), d.[备注], h.[操作员], ISNULL(h.[审核],'0'), CAST(NULL AS nvarchar(40))
      FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
     WHERE d.[仓库]=N'半成品仓' AND (ISNULL(d.[已出数量],0)>0 OR ISNULL(h.[审核],'0')='1')
       AND COALESCE(d.[日期],h.[日期]) >= @start AND COALESCE(d.[日期],h.[日期]) <= @end
       AND (@remark IS NULL OR N'装配领料'=@remark)
       AND (@maker IS NULL OR h.[操作员]=@maker)
       AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
) t
WHERE (@kw IS NULL OR {field} {cmp} @match)
ORDER BY t.[日期], t.[单号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiIssueDetailRow>(sql, new { start, end, kw, match, remark = Norm(q.领料备注), maker = Norm(q.制单人), audit })).AsList();
    }
}
