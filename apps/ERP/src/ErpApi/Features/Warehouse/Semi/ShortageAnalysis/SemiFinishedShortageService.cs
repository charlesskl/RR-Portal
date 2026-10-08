using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public sealed class SemiFinishedShortageService(ISqlConnectionFactory factory) : ISemiFinishedShortageService
{
    private static readonly IReadOnlyDictionary<string, string> Fields =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["productCode"] = "ProductCode",
            ["productName"] = "ProductName",
            ["customer"] = "Customer",
            ["partCode"] = "PartCode"
        };

    private const string AggregateSql = @"
;WITH Demand AS (
    SELECT
        COALESCE(NULLIF(LTRIM(RTRIM([客户名称])), N''), NULLIF(LTRIM(RTRIM([客户编号])), N''), N'') AS Customer,
        LTRIM(RTRIM([款号])) AS ProductCode,
        ISNULL(LTRIM(RTRIM([款式])), N'') AS ProductName,
        SUM(CAST(ISNULL([计划数量], 0) AS decimal(18,4))) AS RequiredQuantity
    FROM [生产制单]
    WHERE ISNULL([审核], '0') = '1'
      AND ISNULL([完成], N'否') <> N'是'
      AND NULLIF(LTRIM(RTRIM([款号])), N'') IS NOT NULL
    GROUP BY
        COALESCE(NULLIF(LTRIM(RTRIM([客户名称])), N''), NULLIF(LTRIM(RTRIM([客户编号])), N''), N''),
        LTRIM(RTRIM([款号])),
        ISNULL(LTRIM(RTRIM([款式])), N'')
), Mappings AS (
    SELECT DISTINCT
        LTRIM(RTRIM([产品货号])) AS ProductCode,
        LTRIM(RTRIM([配件编号])) AS PartCode,
        ISNULL([产品装配名称], N'') AS AssemblyName,
        ISNULL([单位], N'') AS Unit
    FROM [半成品共用物料设置]
    WHERE NULLIF(LTRIM(RTRIM([产品货号])), N'') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM([配件编号])), N'') IS NOT NULL
), Movements AS (
    SELECT
        LTRIM(RTRIM(d.[物料编号])) AS PartCode,
        CAST(ISNULL(d.[数量], 0) AS decimal(18,4)) AS Quantity
    FROM [半成品入仓明细单] d
    JOIN [半成品入仓单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'

    UNION ALL

    SELECT
        LTRIM(RTRIM(d.[物料编号])),
        CAST(ISNULL(d.[数量], 0) AS decimal(18,4)) * -1
    FROM [半成品领料明细单] d
    JOIN [半成品领料单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'

    UNION ALL

    SELECT
        LTRIM(RTRIM(d.[物料编号])),
        CAST(ISNULL(d.[盈亏数量], 0) AS decimal(18,4))
    FROM [半成品盘点明细单] d
    JOIN [半成品盘点单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'

    UNION ALL

    SELECT
        LTRIM(RTRIM(d.[物料编号])),
        CAST(ISNULL(d.[数量], 0) AS decimal(18,4)) * -1
    FROM [半成品退仓明细单] d
    JOIN [半成品退仓单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'

    UNION ALL

    SELECT
        LTRIM(RTRIM(d.[物料编号])),
        CAST(ISNULL(d.[数量], 0) AS decimal(18,4))
    FROM [半成品退库明细单] d
    JOIN [半成品退库单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'

    UNION ALL

    SELECT
        LTRIM(RTRIM(d.[物料编号])),
        CAST(ISNULL(d.[数量], 0) AS decimal(18,4)) * -1
    FROM [半成品报废明细单] d
    JOIN [半成品报废单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核], '0') = '1'
), Inventory AS (
    SELECT PartCode, SUM(Quantity) AS InventoryQuantity
    FROM Movements
    WHERE NULLIF(PartCode, N'') IS NOT NULL
    GROUP BY PartCode
)
SELECT
    d.Customer,
    d.ProductCode,
    d.ProductName,
    m.PartCode,
    m.AssemblyName,
    m.Unit,
    CAST(d.RequiredQuantity AS decimal(18,4)) AS RequiredQuantity,
    CAST(ISNULL(i.InventoryQuantity, 0) AS decimal(18,4)) AS InventoryQuantity,
    CAST(d.RequiredQuantity - ISNULL(i.InventoryQuantity, 0) AS decimal(18,4)) AS ShortageQuantity
INTO #Shortages
FROM Demand d
JOIN Mappings m ON m.ProductCode = d.ProductCode
LEFT JOIN Inventory i ON i.PartCode = m.PartCode
WHERE d.RequiredQuantity - ISNULL(i.InventoryQuantity, 0) > 0;
";

    public Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query) => QueryAsync(query, paged: true);

    public async Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query) =>
        (await QueryAsync(query, paged: false)).Items;

    private async Task<SemiFinishedShortageResult> QueryAsync(SemiFinishedShortageQuery query, bool paged)
    {
        ArgumentNullException.ThrowIfNull(query);

        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 200);
        var field = Fields.TryGetValue(query.Field ?? "", out var selected) ? selected : "ProductCode";
        var keyword = query.Keyword?.Trim();
        var queryKeyword = query.Exact || string.IsNullOrEmpty(keyword)
            ? keyword
            : EscapeLikePattern(keyword);
        var where = string.IsNullOrEmpty(keyword)
            ? ""
            : query.Exact
                ? $"WHERE [{field}] = @Keyword"
                : $"WHERE [{field}] LIKE N'%' + @Keyword + N'%' ESCAPE N'~'";
        var paging = paged ? "OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY" : "";
        var sql = AggregateSql + $@"
SELECT COUNT(1) FROM #Shortages {where};
SELECT Customer, ProductCode, ProductName, PartCode, AssemblyName, Unit,
       RequiredQuantity, InventoryQuantity, ShortageQuantity
FROM #Shortages {where}
ORDER BY Customer, ProductCode, PartCode, ProductName, AssemblyName, Unit
{paging};";

        using var connection = factory.Create();
        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            Keyword = queryKeyword,
            Offset = (long)(page - 1) * pageSize,
            PageSize = pageSize
        });
        var total = await multi.ReadSingleAsync<int>();
        var items = (await multi.ReadAsync<SemiFinishedShortageRow>()).AsList();
        return new SemiFinishedShortageResult(items, total, page, pageSize);
    }

    private static string EscapeLikePattern(string value) => value
        .Replace("~", "~~")
        .Replace("%", "~%")
        .Replace("_", "~_")
        .Replace("[", "~[")
        .Replace("]", "~]");
}
