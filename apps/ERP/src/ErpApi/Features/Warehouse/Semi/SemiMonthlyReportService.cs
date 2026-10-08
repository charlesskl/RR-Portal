using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品库存月报表：按配件编号 收发存。期初=起日期前净额；本期按类分桶；
// 期末=期初+入库-出库-报废+盈亏。入库=入仓+退库，出库=半成品领料+退仓+装配部领料单(仓库=半成品仓,已出口径)（均按单头日期与审核过滤）。
public sealed class SemiMonthlyReportService(ISqlConnectionFactory factory)
{
    private const string DefaultWarehouse = "半成品仓";

    public async Task<IReadOnlyList<SemiMonthlyReportRow>> ReportAsync(SemiMonthlyReportQuery q)
    {
        var warehouse = string.IsNullOrWhiteSpace(q.仓库) ? DefaultWarehouse : q.仓库.Trim();
        var start = (q.起日期 ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var end = (q.止日期 ?? start.AddMonths(1).AddDays(-1)).Date;
        var keyword = string.IsNullOrWhiteSpace(q.Keyword) ? null : q.Keyword.Trim();
        var match = keyword is null || q.Exact ? keyword : $"%{keyword}%";
        var comparer = q.Exact ? "=" : "LIKE";
        var field = q.Field switch
        {
            "产品名称" => "b.[产品名称]",
            "配件编号" => "b.[配件编号]",
            "客户" => "b.[客户]",
            "产品装配名称" => "b.[产品装配名称]",
            _ => "b.[产品货号]"
        };

        // 每条移动一行：入量/出量/废量/盈亏 + 净(有符号，用于期初)。
        const string mv = @"
AllMv AS (
    SELECT d.物料编号, h.日期 AS 日期, d.数量 AS 入量, 0 AS 出量, 0 AS 废量, CAST(0 AS decimal(18,4)) AS 盈亏, d.数量 AS 净
      FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, h.日期, d.数量, 0, 0, CAST(0 AS decimal(18,4)), d.数量
      FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, h.日期, 0, d.数量, 0, CAST(0 AS decimal(18,4)), d.数量*-1
      FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, h.日期, 0, d.数量, 0, CAST(0 AS decimal(18,4)), d.数量*-1
      FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, h.日期, 0, 0, d.数量, CAST(0 AS decimal(18,4)), d.数量*-1
      FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, h.日期, 0, 0, 0, CAST(d.盈亏数量 AS decimal(18,4)), CAST(d.盈亏数量 AS decimal(18,4))
      FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号, COALESCE(d.日期,h.日期), 0,
           (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END),
           0, CAST(0 AS decimal(18,4)),
           (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
),
Agg AS (
    SELECT 物料编号,
        SUM(CASE WHEN 日期 < @start THEN 净 ELSE 0 END) AS 期初库存,
        SUM(CASE WHEN 日期 >= @start AND 日期 <= @end THEN 入量 ELSE 0 END) AS 本期入库,
        SUM(CASE WHEN 日期 >= @start AND 日期 <= @end THEN 出量 ELSE 0 END) AS 本期出库,
        SUM(CASE WHEN 日期 >= @start AND 日期 <= @end THEN 废量 ELSE 0 END) AS 本期报废,
        SUM(CASE WHEN 日期 >= @start AND 日期 <= @end THEN 盈亏 ELSE 0 END) AS 盘点盈亏
    FROM AllMv GROUP BY 物料编号
)";
        // 产品主数据富化（同 picker Base，按配件编号去重取一）
        const string prod = @"
LatestHeader AS (
    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.[款号] ORDER BY h.[ID] DESC) AS hrn
    FROM [款号物料总表] h WHERE NULLIF(LTRIM(RTRIM(h.[款号])), N'') IS NOT NULL
),
DetailFallback AS (
    SELECT d.[款号], MAX(NULLIF(LTRIM(RTRIM(d.[客户名称])), N'')) AS [客户名称],
           MAX(NULLIF(LTRIM(RTRIM(d.[客户])), N'')) AS [客户], MAX(NULLIF(LTRIM(RTRIM(d.[款式])), N'')) AS [款式]
    FROM [款号物料明细表] d GROUP BY d.[款号]
),
BaseRaw AS (
    SELECT COALESCE(NULLIF(LTRIM(RTRIM(s.[配件编号])), N''), h.[产品编号]) AS [配件编号],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[产品装配名称])), N''), NULLIF(LTRIM(RTRIM(h.[款式])), N''), d.[款式]) AS [产品装配名称],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])), N''), NULLIF(LTRIM(RTRIM(h.[客户])), N''), d.[客户名称], d.[客户]) AS [客户],
           h.[款号] AS [产品货号], NULLIF(LTRIM(RTRIM(h.[款式])), N'') AS [产品名称]
    FROM LatestHeader h
    LEFT JOIN [半成品共用物料设置] s ON s.[产品货号]=h.[款号]
    LEFT JOIN DetailFallback d ON d.[款号]=h.[款号]
    WHERE h.hrn=1
),
Prod AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY [配件编号] ORDER BY [产品货号]) AS prn
    FROM BaseRaw WHERE NULLIF(LTRIM(RTRIM([配件编号])), N'') IS NOT NULL
)";
        var sql = $@"WITH {mv},{prod}
SELECT a.物料编号 AS [配件编号], b.[客户], b.[产品货号], b.[产品名称], b.[产品装配名称],
       a.期初库存, a.本期入库, a.本期出库, a.本期报废, a.盘点盈亏,
       (a.期初库存 + a.本期入库 - a.本期出库 - a.本期报废 + a.盘点盈亏) AS [期末库存]
FROM Agg a
LEFT JOIN Prod b ON b.[配件编号] = a.物料编号 AND b.prn = 1
WHERE (a.期初库存 <> 0 OR a.本期入库 <> 0 OR a.本期出库 <> 0 OR a.本期报废 <> 0 OR a.盘点盈亏 <> 0)
  AND (@keyword IS NULL OR {field} {comparer} @match)
ORDER BY b.[产品货号], a.物料编号;";
        using var c = factory.Create(); await c.OpenAsync();
        var rows = await c.QueryAsync<SemiMonthlyReportRow>(sql,
            new { 仓 = warehouse, start, end, keyword, match });
        return rows.AsList();
    }
}
