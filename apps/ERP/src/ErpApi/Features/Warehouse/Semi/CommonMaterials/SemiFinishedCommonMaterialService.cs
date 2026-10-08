using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Warehouse.Semi.CommonMaterials;

public sealed class SemiFinishedCommonMaterialService(ISqlConnectionFactory factory)
{
    public async Task SetAuditAsync(string 产品货号, bool audited, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var style = await c.QuerySingleOrDefaultAsync<StyleHeaderRow>(@"
SELECT TOP (1) [款号],[款式] FROM [款号总表]
WHERE [款号]=@产品货号 ORDER BY [ID] DESC", new { 产品货号 }, tx);
            if (style is null) throw new InvalidOperationException($"产品货号 [{产品货号}] 不存在。");
            var existing = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [半成品共用物料设置] WHERE [产品货号]=@产品货号",
                new { 产品货号 }, tx);
            if (!audited && existing == 0)
                throw new InvalidOperationException($"产品货号 [{产品货号}] 尚未审核。");
            var header = await c.QuerySingleOrDefaultAsync<MaterialHeaderRow>(@"
SELECT TOP (1) [产品编号],[单位],[备注]
FROM [款号物料总表] WHERE [款号]=@产品货号 ORDER BY [ID] DESC", new { 产品货号 }, tx);

            await c.ExecuteAsync(@"
MERGE [半成品共用物料设置] AS target
USING (SELECT @产品货号 AS [产品货号], @产品装配名称 AS [产品装配名称],
              @配件编号 AS [配件编号], @单位 AS [单位], @备注内容 AS [备注内容]) AS source
ON target.[产品货号] = source.[产品货号]
WHEN MATCHED THEN UPDATE SET
    [调整审核]=@调整审核,
    [审核人]=CASE WHEN @调整审核=1 THEN @审核人 ELSE NULL END,
    [审核时间]=CASE WHEN @调整审核=1 THEN SYSDATETIME() ELSE NULL END
WHEN NOT MATCHED AND @调整审核=1 THEN
    INSERT([产品货号],[产品装配名称],[配件编号],[单位],[备注内容],[调整审核],[审核人],[审核时间])
    VALUES(source.[产品货号],source.[产品装配名称],source.[配件编号],source.[单位],source.[备注内容],@调整审核,@审核人,SYSDATETIME());
", new
            {
                产品货号, 产品装配名称 = style.款式, 配件编号 = header?.产品编号,
                单位 = header?.单位, 备注内容 = header?.备注,
                调整审核 = audited ? 1 : 0, 审核人 = user
            }, tx);
            tx.Commit();
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    public async Task<PagedResult<SemiFinishedCommonMaterialRow>> ListAsync(
        SemiFinishedCommonMaterialQuery query,
        bool canSeePrice)
    {
        var page = Math.Max(query.Page, 1);
        var size = Math.Clamp(query.Size, 1, 1000);
        var keyword = string.IsNullOrWhiteSpace(query.Keyword) ? null : query.Keyword.Trim();
        var match = query.精确 || keyword is null ? keyword : $"%{keyword}%";
        var fieldSql = query.查询字段 switch
        {
            "产品名称" => "b.[产品名称]",
            "产品装配名称" => "b.[产品装配名称]",
            "配件编号" => "b.[配件编号]",
            "共用物料编号" => "b.[共用物料编号]",
            "客户" => "b.[客户]",
            _ => "b.[产品货号]"
        };

        var cte = $@"
WITH LatestHeader AS (
    SELECT h.*,
           ROW_NUMBER() OVER (PARTITION BY h.[款号] ORDER BY h.[ID] DESC) AS rn
    FROM [款号物料总表] h
    WHERE NULLIF(LTRIM(RTRIM(h.[款号])), N'') IS NOT NULL
),
DetailFallback AS (
    SELECT d.[款号],
           MAX(NULLIF(LTRIM(RTRIM(d.[客户名称])), N'')) AS [客户名称],
           MAX(NULLIF(LTRIM(RTRIM(d.[客户])), N'')) AS [客户],
           MAX(NULLIF(LTRIM(RTRIM(d.[款式])), N'')) AS [款式]
    FROM [款号物料明细表] d
    GROUP BY d.[款号]
),
Base AS (
    SELECT h.[款号] AS [产品货号],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])), N''),
                    NULLIF(LTRIM(RTRIM(h.[客户])), N''), d.[客户名称], d.[客户]) AS [客户],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[款式])), N''), d.[款式]) AS [产品名称],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[产品装配名称])), N''),
                    NULLIF(LTRIM(RTRIM(h.[款式])), N''), d.[款式]) AS [产品装配名称],
           s.[库存单价HK] AS [库存单价],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[配件编号])), N''), h.[产品编号]) AS [配件编号],
           s.[共用物料编号],
           CASE WHEN ISNULL(s.[调整审核], 0) = 1 THEN N'已审核' ELSE N'未审核' END AS [调整审核],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[备注内容])), N''), h.[备注]) AS [备注内容]
    FROM LatestHeader h
    LEFT JOIN [半成品共用物料设置] s ON s.[产品货号] = h.[款号]
    LEFT JOIN DetailFallback d ON d.[款号] = h.[款号]
    WHERE h.rn = 1
),
Numbered AS (
    SELECT b.*,
           COUNT(*) OVER (PARTITION BY NULLIF(LTRIM(RTRIM([共用物料编号])), N'')) AS DuplicateCount
    FROM Base b
),
Filtered AS (
    SELECT b.*
    FROM Numbered b
    WHERE (@showDuplicates = 0 OR (
              NULLIF(LTRIM(RTRIM(b.[共用物料编号])), N'') IS NOT NULL
              AND b.DuplicateCount >= 2))
      AND (@pendingMode = 0
           OR (@pendingMode = 1 AND NULLIF(LTRIM(RTRIM(b.[共用物料编号])), N'') IS NULL)
           OR (@pendingMode = 2 AND NULLIF(LTRIM(RTRIM(b.[共用物料编号])), N'') IS NOT NULL))
      AND (@auditMode = 0
           OR (@auditMode = 1 AND b.[调整审核] = N'未审核')
           OR (@auditMode = 2 AND b.[调整审核] = N'已审核'))
      AND (@keyword IS NULL OR {fieldSql} LIKE @match)
)";

        var sql = $@"
{cte}
SELECT COUNT(*) FROM Filtered;
{cte}
SELECT [产品货号], [客户], [产品名称], [产品装配名称], [库存单价],
       [配件编号], [共用物料编号], [调整审核], [备注内容]
FROM Filtered
ORDER BY [产品货号]
OFFSET (@page - 1) * @size ROWS FETCH NEXT @size ROWS ONLY;";

        var parameters = new
        {
            showDuplicates = query.重复内容 == "显示重复" ? 1 : 0,
            pendingMode = query.待操作物料 switch { "待设置" => 1, "已设置" => 2, _ => 0 },
            auditMode = query.审核情况 switch { "未审核" => 1, "已审核" => 2, _ => 0 },
            keyword,
            match,
            page,
            size
        };

        await using var connection = factory.Create();
        await connection.OpenAsync();
        using var multi = await connection.QueryMultipleAsync(sql, parameters);
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiFinishedCommonMaterialRow>()).AsList();

        if (!canSeePrice)
            foreach (var row in items)
                row.库存单价 = null;

        return new PagedResult<SemiFinishedCommonMaterialRow>(items, total);
    }

    private sealed class StyleHeaderRow
    {
        public string? 款号 { get; set; }
        public string? 款式 { get; set; }
    }

    private sealed class MaterialHeaderRow
    {
        public string? 产品编号 { get; set; }
        public string? 单位 { get; set; }
        public string? 备注 { get; set; }
    }
}
