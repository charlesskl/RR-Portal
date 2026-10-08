using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品库存统计表（自由选产品版报表）。库存按 配件编号(=物料编号) 汇总各颜色，再富化 客户/产品货号/产品名称/产品装配名称/仓库位置。
// 库存 7 分支与 InventorySummaryService.SemiSql 一致（含 装配部领料单 仓库=半成品仓 的已出扣减），仅 group 到 物料编号。产品富化复用 picker Base CTE。
public sealed class SemiInventoryReportService(ISqlConnectionFactory factory)
{
    private const string DefaultWarehouse = "半成品仓";

    public async Task<IReadOnlyList<SemiInventoryReportRow>> ReportAsync(SemiInventoryReportQuery q)
    {
        var warehouse = string.IsNullOrWhiteSpace(q.仓库) ? DefaultWarehouse : q.仓库.Trim();
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

        // 公共 CTE：库存(按物料编号) + 产品主数据(按配件编号，去重取一)
        var ctes = @"
Inv AS (
    SELECT 物料编号, SUM(库存) AS 库存数量 FROM (
        SELECT d.物料编号, d.数量            AS 库存 FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, d.数量*-1 FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, d.数量*-1 FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, CAST(d.盈亏数量 AS decimal(18,4)) FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, d.数量     FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, d.数量*-1 FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
        UNION ALL SELECT d.物料编号, (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1
            FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
    ) t GROUP BY 物料编号
),
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

        // 显示：有发生的记录(以 Inv 为基) / 全部记录(以 产品主数据 为基，库存缺省 0)
        string select = q.ShowAll
            ? $@"
SELECT b.[配件编号], b.[客户], b.[产品货号], b.[产品名称], b.[产品装配名称],
       ISNULL(i.库存数量, 0) AS [库存数量], loc.[仓库位置]
FROM Prod b
LEFT JOIN Inv i ON i.物料编号 = b.[配件编号]
OUTER APPLY (SELECT TOP (1) m.[仓库位置] FROM [物料资料] m WHERE m.[物料编号]=b.[配件编号] AND NULLIF(LTRIM(RTRIM(m.[仓库位置])),N'') IS NOT NULL ORDER BY m.[ID] DESC) loc
WHERE b.prn = 1
  AND (@includeZero = 1 OR ISNULL(i.库存数量, 0) <> 0)
  AND (@keyword IS NULL OR {field} {comparer} @match)
ORDER BY b.[产品货号], b.[配件编号];"
            : $@"
SELECT i.物料编号 AS [配件编号], b.[客户], b.[产品货号], b.[产品名称], b.[产品装配名称],
       i.库存数量 AS [库存数量], loc.[仓库位置]
FROM Inv i
LEFT JOIN Prod b ON b.[配件编号] = i.物料编号 AND b.prn = 1
OUTER APPLY (SELECT TOP (1) m.[仓库位置] FROM [物料资料] m WHERE m.[物料编号]=i.物料编号 AND NULLIF(LTRIM(RTRIM(m.[仓库位置])),N'') IS NOT NULL ORDER BY m.[ID] DESC) loc
WHERE (@includeZero = 1 OR i.库存数量 <> 0)
  AND (@keyword IS NULL OR {field} {comparer} @match)
ORDER BY b.[产品货号], i.物料编号;";

        var sql = "WITH " + ctes + select;
        using var c = factory.Create(); await c.OpenAsync();
        var rows = await c.QueryAsync<SemiInventoryReportRow>(sql,
            new { 仓 = warehouse, keyword, match, includeZero = q.IncludeZero ? 1 : 0 });
        return rows.AsList();
    }
}
