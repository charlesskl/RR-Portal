using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品退仓查询：对 半成品退仓单/明细单 的汇总与明细报表。明细自带产品列。日期为 date 型。
public sealed class SemiWhReturnQueryService(ISqlConnectionFactory factory)
{
    private static string FieldExpr(string? f) => f switch
    {
        "产品名称" => "d.[名称]",
        "配件编号" => "d.[物料编号]",
        "客户" => "d.[客户]",
        "产品货号" => "d.[货号]",
        _ => "d.[物料名称]"   // 默认 产品装配名称
    };
    private (DateTime start, DateTime end, string? kw, string? match, string cmp) Common(SemiWhReturnQueryDto q)
    {
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date;
        var kw = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = kw is null || q.Exact ? kw : $"%{kw}%";
        return (start, end, kw, match, q.Exact ? "=" : "LIKE");
    }

    public async Task<IReadOnlyList<SemiWhReturnSummaryRow>> SummaryAsync(SemiWhReturnQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var supplierGrp = q.BySupplier ? ", h.[供应商编号], h.[供应商名称]" : "";
        var supplierSel = q.BySupplier ? "h.[供应商编号] AS [供应商编号], h.[供应商名称] AS [供应商名称]," : "CAST(NULL AS nvarchar(80)) AS [供应商编号], CAST(NULL AS nvarchar(200)) AS [供应商名称],";
        var goodsGrp = q.MaterialOnly ? "" : ", d.[货号]";
        var goodsSel = q.MaterialOnly ? "MAX(d.[货号])" : "d.[货号]";
        var sql = $@"
SELECT d.[物料编号] AS [配件编号], {goodsSel} AS [产品货号], MAX(d.[名称]) AS [产品名称], MAX(d.[物料名称]) AS [产品装配名称],
       {supplierSel} SUM(d.[数量]) AS [退仓数量]
FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@kw IS NULL OR {field} {cmp} @match)
GROUP BY d.[物料编号]{goodsGrp}{supplierGrp}
ORDER BY MAX(d.[货号]), d.[物料编号];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiWhReturnSummaryRow>(sql, new { start, end, kw, match })).AsList();
    }

    public async Task<IReadOnlyList<SemiWhReturnDetailRow>> DetailAsync(SemiWhReturnQueryDto q)
    {
        var (start, end, kw, match, cmp) = Common(q);
        var field = FieldExpr(q.Field);
        var audit = q.审核 is "0" or "1" ? q.审核 : null;
        var sql = $@"
SELECT h.[日期], h.[单号] AS [单号], h.[供应商编号], h.[供应商名称], h.[入仓单号], d.[生产单号],
       d.[物料编号] AS [配件编号], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[物料名称] AS [产品装配名称],
       d.[数量], d.[备注], ISNULL(h.[审核],'0') AS [审核]
FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.[单号]=d.[单号]
WHERE h.[日期] >= @start AND h.[日期] <= @end
  AND (@audit IS NULL OR ISNULL(h.[审核],'0')=@audit)
  AND (@kw IS NULL OR {field} {cmp} @match)
ORDER BY h.[日期], h.[单号], d.[ID];";
        using var c = factory.Create();
        return (await c.QueryAsync<SemiWhReturnDetailRow>(sql, new { start, end, kw, match, audit })).AsList();
    }
}
