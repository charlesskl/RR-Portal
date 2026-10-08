using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Assembly;

public sealed class AssemblyPurchaseQueryService(ISqlConnectionFactory factory)
{
    private static string? Like(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : $"%{value.Trim()}%";

    private static string? Exact(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : value.Trim();

    private static string ApprovalFilter(string? 审核情况, string alias = "h") => 审核情况 switch
    {
        "已审核" => $" AND ISNULL({alias}.[审核], '0') = '1'",
        "未审核" => $" AND ISNULL({alias}.[审核], '0') <> '1'",
        _ => "",
    };

    // 快照化统计口径（2026-07-28 技术债清理，配合 db/44 装配加工采购单落库）：
    // - 物料展开类报表（tracking/required-materials/factory-inventory/auxiliary-issue-progress/factory-category-monthly）
    //   数据源 = 已落库单快照（装配加工采购单明细）∪ 实时展开（款号物料总表×款号物料明细表）。
    // - 单据类报表（summary/detail，2026-08-04 补齐）：数据源 = 落库采购单（装配加工采购单×生产明细）∪ 实时虚拟单
    //   （款号物料总表 ZP+ID），产品级配对去重（SnapshotExcludeProductSql，判定表=装配加工采购单生产明细）。
    // - 防重复计数：实时展开的归属键是（最近MO.生产单号 + 款号）；该组合一旦存在落库单明细行，
    //   实时部分用 NOT EXISTS 整组排除，统计只按快照计一次；删除落库单后自动回到实时展开。
    // - 快照行数量口径：需求数量=快照行.需求数量（保存时允许改过），单件用量=快照行.用量，
    //   加工数量=同单同 生产单号+款号 的生产明细.加工数量（取不到回退单头.数量）。
    // - 快照行的 规格/颜色/物料类别 取自物料主档（非 BOM，允许实时），日期/审核/收货仓库/供应商取落库单单头。
    // - 边界：明细行 款号 为空的落库单（无生产明细且未填款号）无法与实时展开配对，两边各自统计，不去重。
    private const string SnapshotExcludeSql = @"
      AND NOT EXISTS (
            SELECT 1
            FROM [装配加工采购单明细] sd
            WHERE sd.[款号] = h.[款号]
              AND (sd.[生产单号] = mo.[生产单号] OR (sd.[生产单号] IS NULL AND mo.[生产单号] IS NULL))
          )";

    // 产品级配对去重（Summary/Detail 用）：实时虚拟单的归属键同样是（最近MO.生产单号 + 款号），
    // 但判定表换成 [装配加工采购单生产明细]（产品行），与物料级（装配加工采购单明细）口径对应。
    // 该组合一旦落库，实时虚拟行整组排除，进度/汇总只显示落库单；删单后自动回到实时。
    private const string SnapshotExcludeProductSql = @"
      AND NOT EXISTS (
            SELECT 1
            FROM [装配加工采购单生产明细] pd
            WHERE pd.[款号] = h.[款号]
              AND (pd.[生产单号] = mo.[生产单号] OR (pd.[生产单号] IS NULL AND mo.[生产单号] IS NULL))
          )";

    public async Task<IReadOnlyList<AssemblyPurchaseSummaryRow>> SummaryAsync(
        DateTime 起,
        DateTime 止,
        string? keyword,
        string? 收货仓库,
        string? 审核情况)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyPurchaseSummaryRow>($@"
WITH src AS (
    SELECT
        po.[日期] AS 订购日期,
        po.[单号],
        po.[收货仓库],
        pd.[款号] AS 产品货号,
        pd.[配件编号],
        COALESCE(pd.[产品装配名称], pd.[产品名称]) AS 产品装配名称,
        po.[装配方式],
        pd.[生产单号],
        COALESCE(pd.[加工数量], po.[数量], 0) AS 加工数量
    FROM [装配加工采购单生产明细] pd
    JOIN [装配加工采购单] po ON po.[单号] = pd.[单号]
    WHERE po.[日期] >= @start AND po.[日期] < @end
      AND (@kw IS NULL OR po.[单号] LIKE @kw OR pd.[款号] LIKE @kw OR COALESCE(pd.[产品装配名称], pd.[产品名称]) LIKE @kw OR pd.[配件编号] LIKE @kw OR pd.[生产单号] LIKE @kw OR po.[客户名称] LIKE @kw)
      AND (@warehouse IS NULL OR po.[收货仓库] = @warehouse)
      {ApprovalFilter(审核情况, "po")}

    UNION ALL

    SELECT
        h.[日期] AS 订购日期,
        CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 单号,
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        h.[款号] AS 产品货号,
        h.[产品编号] AS 配件编号,
        h.[款式] AS 产品装配名称,
        h.[制作要求] AS 装配方式,
        mo.[生产单号],
        COALESCE(mo.[接单数量], h.[使用数量], 0) AS 加工数量
    FROM [款号物料总表] h
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    WHERE h.[日期] >= @start AND h.[日期] < @end
      AND (@kw IS NULL OR h.[款号] LIKE @kw OR h.[款式] LIKE @kw OR h.[产品编号] LIKE @kw OR mo.[生产单号] LIKE @kw OR h.[客户名称] LIKE @kw OR h.[客户] LIKE @kw)
      AND (@warehouse IS NULL OR CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END = @warehouse)
      {ApprovalFilter(审核情况)}{SnapshotExcludeProductSql}
)
SELECT
    单号,
    收货仓库,
    产品货号,
    配件编号,
    产品装配名称,
    装配方式,
    生产单号,
    加工数量
FROM src
ORDER BY 订购日期 DESC, 单号 DESC;", new
        {
            start = 起.Date,
            end = 止.Date.AddDays(1),
            kw = Like(keyword),
            warehouse = Exact(收货仓库),
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AssemblyPurchaseDetailRow>> DetailAsync(
        DateTime 起,
        DateTime 止,
        string? keyword,
        string? 收货仓库,
        string? 审核情况)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyPurchaseDetailRow>($@"
WITH src AS (
    SELECT
        po.[日期] AS 开单日期,
        po.[单号],
        po.[完成日期],
        po.[收货仓库],
        po.[供应商编号],
        po.[供应商名称],
        pd.[款号] AS 产品货号,
        pd.[配件编号],
        COALESCE(pd.[产品装配名称], pd.[产品名称]) AS 产品装配名称,
        po.[装配方式],
        pd.[生产单号],
        N'￥' AS 货币,
        COALESCE(pd.[加工数量], po.[数量], 0) AS 数量,
        po.[备注],
        po.[审核]
    FROM [装配加工采购单生产明细] pd
    JOIN [装配加工采购单] po ON po.[单号] = pd.[单号]
    WHERE po.[日期] >= @start AND po.[日期] < @end
      AND (@kw IS NULL OR po.[单号] LIKE @kw OR pd.[款号] LIKE @kw OR COALESCE(pd.[产品装配名称], pd.[产品名称]) LIKE @kw OR pd.[配件编号] LIKE @kw OR pd.[生产单号] LIKE @kw OR po.[客户名称] LIKE @kw OR po.[供应商编号] LIKE @kw OR po.[供应商名称] LIKE @kw)
      AND (@warehouse IS NULL OR po.[收货仓库] = @warehouse)
      {ApprovalFilter(审核情况, "po")}

    UNION ALL

    SELECT
        h.[日期] AS 开单日期,
        CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 单号,
        CAST(NULL AS datetime) AS 完成日期,
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        prod.[加工厂编号] AS 供应商编号,
        prod.[加工厂名称] AS 供应商名称,
        h.[款号] AS 产品货号,
        h.[产品编号] AS 配件编号,
        h.[款式] AS 产品装配名称,
        h.[制作要求] AS 装配方式,
        mo.[生产单号],
        N'￥' AS 货币,
        COALESCE(mo.[接单数量], h.[使用数量], 0) AS 数量,
        h.[备注],
        h.[审核]
    FROM [款号物料总表] h
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    OUTER APPLY (
        SELECT TOP 1 [加工厂编号], [加工厂名称]
        FROM [生产制单] p
        WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
        ORDER BY p.[ID] DESC
    ) prod
    WHERE h.[日期] >= @start AND h.[日期] < @end
      AND (@kw IS NULL OR h.[款号] LIKE @kw OR h.[款式] LIKE @kw OR h.[产品编号] LIKE @kw OR mo.[生产单号] LIKE @kw OR h.[客户名称] LIKE @kw OR h.[客户] LIKE @kw)
      AND (@warehouse IS NULL OR CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END = @warehouse)
      {ApprovalFilter(审核情况)}{SnapshotExcludeProductSql}
)
SELECT
    开单日期,
    单号,
    完成日期,
    收货仓库,
    供应商编号,
    供应商名称,
    产品货号,
    配件编号,
    产品装配名称,
    装配方式,
    生产单号,
    货币,
    数量,
    备注,
    审核
FROM src
ORDER BY 开单日期 DESC, 单号 DESC;", new
        {
            start = 起.Date,
            end = 止.Date.AddDays(1),
            kw = Like(keyword),
            warehouse = Exact(收货仓库),
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AssemblyMaterialTrackingRow>> TrackingAsync(
        DateTime 起,
        DateTime 止,
        string? keyword,
        string? 收货仓库,
        bool 截止统计)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyMaterialTrackingRow>($@"
WITH src AS (
    SELECT
        h.[日期] AS 订购日期,
        CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 订单单号,
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        prod.[加工厂编号],
        prod.[加工厂名称],
        h.[款号] AS 产品货号,
        COALESCE(mo.[产品名称], h.[款式]) AS 产品名称,
        h.[产品编号] AS 配件编号,
        h.[款式] AS 产品装配名称,
        h.[制作要求] AS 装配方式,
        mo.[生产单号],
        d.[物料编号],
        d.[物料名称],
        d.[规格],
        d.[物料类别] AS 材料,
        d.[颜色],
        d.[单位],
        ISNULL(d.[使用数量], 0) AS 单件用量,
        COALESCE(mo.[接单数量], h.[使用数量], 0) AS 加工数量,
        COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) AS 需求数量,
        h.[审核]
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [产品名称], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    OUTER APPLY (
        SELECT TOP 1 [加工厂编号], [加工厂名称]
        FROM [生产制单] p
        WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
        ORDER BY p.[ID] DESC
    ) prod
    WHERE (
            (@deadline = 1 AND h.[日期] < @end)
            OR (@deadline = 0 AND h.[日期] >= @start AND h.[日期] < @end)
          ){SnapshotExcludeSql}

    UNION ALL

    SELECT
        po.[日期] AS 订购日期,
        po.[单号] AS 订单单号,
        po.[收货仓库],
        po.[供应商编号] AS 加工厂编号,
        po.[供应商名称] AS 加工厂名称,
        sd.[款号] AS 产品货号,
        COALESCE(pd.[产品名称], pd.[产品装配名称]) AS 产品名称,
        pd.[配件编号],
        pd.[产品装配名称],
        po.[装配方式],
        sd.[生产单号],
        sd.[物料编号],
        sd.[物料名称],
        m.[规格],
        m.[物料类别] AS 材料,
        m.[颜色],
        sd.[单位],
        ISNULL(sd.[用量], 0) AS 单件用量,
        COALESCE(pd.[加工数量], po.[数量], 0) AS 加工数量,
        ISNULL(sd.[需求数量], 0) AS 需求数量,
        po.[审核]
    FROM [装配加工采购单明细] sd
    JOIN [装配加工采购单] po ON po.[单号] = sd.[单号]
    LEFT JOIN [物料资料] m ON m.[物料编号] = sd.[物料编号]
    OUTER APPLY (
        SELECT TOP 1 [产品名称], [配件编号], [产品装配名称], [加工数量]
        FROM [装配加工采购单生产明细] p
        WHERE p.[单号] = sd.[单号]
          AND (p.[款号] = sd.[款号] OR (p.[款号] IS NULL AND sd.[款号] IS NULL))
          AND (p.[生产单号] = sd.[生产单号] OR (p.[生产单号] IS NULL AND sd.[生产单号] IS NULL))
        ORDER BY p.[行号], p.[ID]
    ) pd
    WHERE (
            (@deadline = 1 AND po.[日期] < @end)
            OR (@deadline = 0 AND po.[日期] >= @start AND po.[日期] < @end)
          )
)
SELECT
    订购日期,
    订单单号,
    收货仓库,
    加工厂编号,
    加工厂名称,
    产品货号,
    产品名称,
    配件编号,
    产品装配名称,
    装配方式,
    生产单号,
    物料编号,
    物料名称,
    规格,
    材料,
    颜色,
    单位,
    单件用量,
    加工数量,
    需求数量,
    CAST(0 AS decimal(18,4)) AS 已入仓数量,
    需求数量 AS 未入仓数量,
    审核
FROM src
WHERE (@kw IS NULL
       OR 订单单号 LIKE @kw
       OR 产品货号 LIKE @kw
       OR 产品装配名称 LIKE @kw
       OR 配件编号 LIKE @kw
       OR 生产单号 LIKE @kw
       OR 加工厂编号 LIKE @kw
       OR 加工厂名称 LIKE @kw
       OR 物料编号 LIKE @kw
       OR 物料名称 LIKE @kw)
  AND (@warehouse IS NULL OR 收货仓库 = @warehouse)
ORDER BY 订购日期 DESC, 订单单号 DESC, 物料编号;", new
        {
            start = 起.Date,
            end = 止.Date.AddDays(1),
            kw = Like(keyword),
            warehouse = Exact(收货仓库),
            deadline = 截止统计 ? 1 : 0,
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AssemblyFactoryInventoryRow>> FactoryInventoryAsync(
        DateTime? 起,
        DateTime? 止,
        bool 启用日期,
        DateTime 截止日期,
        string? 加工厂,
        string? 物料分类,
        string? 收货仓库,
        string? keyword)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyFactoryInventoryRow>($@"
WITH src AS (
    SELECT
        prod.[加工厂编号],
        prod.[加工厂名称],
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        d.[物料类别] AS 物料分类,
        h.[款号] AS 产品货号,
        COALESCE(mo.[产品名称], h.[款式]) AS 产品名称,
        d.[物料编号],
        d.[物料名称],
        d.[规格],
        d.[物料类别] AS 材料,
        d.[颜色],
        d.[单位],
        COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) AS 领料数量,
        CAST(0 AS decimal(18,4)) AS 送货数量,
        h.[日期] AS 订购日期
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [产品名称], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    OUTER APPLY (
        SELECT TOP 1 [加工厂编号], [加工厂名称]
        FROM [生产制单] p
        WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
        ORDER BY p.[ID] DESC
    ) prod
    WHERE h.[日期] < @cutoffEnd
      AND (@useDate = 0 OR (h.[日期] >= @start AND h.[日期] < @end))
      AND (@factory IS NULL OR prod.[加工厂编号] LIKE @factory OR prod.[加工厂名称] LIKE @factory)
      AND (@category IS NULL OR d.[物料类别] = @category)
      AND (@warehouse IS NULL OR CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END = @warehouse)
      AND (@kw IS NULL
           OR h.[款号] LIKE @kw
           OR h.[款式] LIKE @kw
           OR h.[产品编号] LIKE @kw
           OR mo.[生产单号] LIKE @kw
           OR prod.[加工厂编号] LIKE @kw
           OR prod.[加工厂名称] LIKE @kw
           OR d.[物料编号] LIKE @kw
           OR d.[物料名称] LIKE @kw){SnapshotExcludeSql}

    UNION ALL

    SELECT
        po.[供应商编号] AS 加工厂编号,
        po.[供应商名称] AS 加工厂名称,
        po.[收货仓库],
        m.[物料类别] AS 物料分类,
        sd.[款号] AS 产品货号,
        COALESCE(pd.[产品名称], pd.[产品装配名称]) AS 产品名称,
        sd.[物料编号],
        sd.[物料名称],
        m.[规格],
        m.[物料类别] AS 材料,
        m.[颜色],
        sd.[单位],
        ISNULL(sd.[需求数量], 0) AS 领料数量,
        CAST(0 AS decimal(18,4)) AS 送货数量,
        po.[日期] AS 订购日期
    FROM [装配加工采购单明细] sd
    JOIN [装配加工采购单] po ON po.[单号] = sd.[单号]
    LEFT JOIN [物料资料] m ON m.[物料编号] = sd.[物料编号]
    OUTER APPLY (
        SELECT TOP 1 [产品名称], [配件编号], [产品装配名称]
        FROM [装配加工采购单生产明细] p
        WHERE p.[单号] = sd.[单号]
          AND (p.[款号] = sd.[款号] OR (p.[款号] IS NULL AND sd.[款号] IS NULL))
          AND (p.[生产单号] = sd.[生产单号] OR (p.[生产单号] IS NULL AND sd.[生产单号] IS NULL))
        ORDER BY p.[行号], p.[ID]
    ) pd
    WHERE po.[日期] < @cutoffEnd
      AND (@useDate = 0 OR (po.[日期] >= @start AND po.[日期] < @end))
      AND (@factory IS NULL OR po.[供应商编号] LIKE @factory OR po.[供应商名称] LIKE @factory)
      AND (@category IS NULL OR m.[物料类别] = @category)
      AND (@warehouse IS NULL OR po.[收货仓库] = @warehouse)
      AND (@kw IS NULL
           OR sd.[款号] LIKE @kw
           OR pd.[产品装配名称] LIKE @kw
           OR pd.[配件编号] LIKE @kw
           OR sd.[生产单号] LIKE @kw
           OR po.[供应商编号] LIKE @kw
           OR po.[供应商名称] LIKE @kw
           OR sd.[物料编号] LIKE @kw
           OR sd.[物料名称] LIKE @kw)
)
SELECT
    加工厂编号,
    加工厂名称,
    收货仓库,
    物料分类,
    产品货号,
    产品名称,
    物料编号,
    物料名称,
    规格,
    材料,
    颜色,
    单位,
    SUM(领料数量) AS 领料数量,
    SUM(送货数量) AS 送货数量,
    SUM(领料数量) - SUM(送货数量) AS 库存数量,
    MAX(订购日期) AS 最后订购日期,
    @cutoffDate AS 领料送货截止日期
FROM src
GROUP BY
    加工厂编号, 加工厂名称, 收货仓库, 物料分类, 产品货号, 产品名称,
    物料编号, 物料名称, 规格, 材料, 颜色, 单位
ORDER BY 加工厂编号, 加工厂名称, 产品货号, 物料编号;", new
        {
            start = 启用日期 ? 起?.Date : null,
            end = 启用日期 ? 止?.Date.AddDays(1) : null,
            useDate = 启用日期 ? 1 : 0,
            cutoffDate = 截止日期.Date,
            cutoffEnd = 截止日期.Date.AddDays(1),
            factory = Like(加工厂),
            category = Exact(物料分类),
            warehouse = Exact(收货仓库),
            kw = Like(keyword),
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AssemblyRequiredMaterialRow>> RequiredMaterialsAsync(
        DateTime 起,
        DateTime 止,
        string? keyword,
        string? 收货仓库,
        string? 类型,
        string? 审核情况)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyRequiredMaterialRow>($@"
WITH src AS (
    SELECT
        h.[日期] AS 日期,
        CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 单号,
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        prod.[加工厂编号] AS 供应商编号,
        prod.[加工厂名称] AS 供应商名称,
        h.[款号] AS 产品货号,
        h.[款式] AS 产品装配名称,
        h.[产品编号] AS 配件编号,
        h.[制作要求] AS 装配方式,
        mo.[生产单号],
        d.[物料编号],
        d.[物料名称],
        d.[物料类别] AS 物料类别,
        COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) AS 需领数量,
        h.[审核]
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 x.[生产单号], x.[产品名称], x.[接单数量]
        FROM (
            SELECT mo.[生产单号], mo.[产品名称], mo.[接单数量], mo.[接单日期] AS [排序日期], mo.[ID], 0 AS [优先级]
            FROM [生产通知单MO单] mo
            WHERE mo.[产品货号] = h.[款号]
            UNION ALL
            -- MO 单未录入时回退到生产制单(本系统生产单主表),否则按生产单号搜索不到
            SELECT p.[生产单号], p.[款式], p.[接单数量], p.[日期], p.[ID], 1
            FROM [生产制单] p
            WHERE p.[款号] = h.[款号]
        ) x
        ORDER BY CASE WHEN @kw IS NOT NULL AND x.[生产单号] LIKE @kw THEN -1 ELSE x.[优先级] END,
                 x.[优先级], x.[排序日期] DESC, x.[ID] DESC
    ) mo
    OUTER APPLY (
        SELECT TOP 1 [加工厂编号], [加工厂名称]
        FROM [生产制单] p
        WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
        ORDER BY p.[ID] DESC
    ) prod
    WHERE h.[日期] >= @start AND h.[日期] < @end{SnapshotExcludeSql}

    UNION ALL

    SELECT
        po.[日期] AS 日期,
        po.[单号] AS 单号,
        po.[收货仓库],
        po.[供应商编号],
        po.[供应商名称],
        sd.[款号] AS 产品货号,
        pd.[产品装配名称],
        pd.[配件编号],
        po.[装配方式],
        sd.[生产单号],
        sd.[物料编号],
        sd.[物料名称],
        m.[物料类别],
        ISNULL(sd.[需求数量], 0) AS 需领数量,
        po.[审核]
    FROM [装配加工采购单明细] sd
    JOIN [装配加工采购单] po ON po.[单号] = sd.[单号]
    LEFT JOIN [物料资料] m ON m.[物料编号] = sd.[物料编号]
    OUTER APPLY (
        SELECT TOP 1 [配件编号], [产品装配名称]
        FROM [装配加工采购单生产明细] p
        WHERE p.[单号] = sd.[单号]
          AND (p.[款号] = sd.[款号] OR (p.[款号] IS NULL AND sd.[款号] IS NULL))
          AND (p.[生产单号] = sd.[生产单号] OR (p.[生产单号] IS NULL AND sd.[生产单号] IS NULL))
        ORDER BY p.[行号], p.[ID]
    ) pd
    WHERE po.[日期] >= @start AND po.[日期] < @end
)
SELECT
    日期,
    单号,
    收货仓库,
    供应商编号,
    供应商名称,
    产品货号,
    产品装配名称,
    装配方式,
    生产单号,
    物料编号,
    物料名称,
    需领数量,
    审核
FROM src
WHERE (@kw IS NULL
       OR 单号 LIKE @kw
       OR 产品货号 LIKE @kw
       OR 产品装配名称 LIKE @kw
       OR 配件编号 LIKE @kw
       OR 生产单号 LIKE @kw
       OR 供应商编号 LIKE @kw
       OR 供应商名称 LIKE @kw
       OR 物料编号 LIKE @kw
       OR 物料名称 LIKE @kw)
  AND (@warehouse IS NULL OR 收货仓库 = @warehouse)
  AND (@type IS NULL OR 装配方式 = @type OR 装配方式 LIKE @typeLike OR 物料类别 = @type)
  {ApprovalFilter(审核情况, "src")}
ORDER BY 日期 DESC, 单号 DESC, 物料编号;", new
        {
            start = 起.Date,
            end = 止.Date.AddDays(1),
            kw = Like(keyword),
            warehouse = Exact(收货仓库),
            type = Exact(类型),
            typeLike = Like(类型),
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryIssueProgressRow>> AuxiliaryIssueProgressAsync(
        DateTime? 起,
        DateTime? 止,
        string? keyword,
        string? 到货情况,
        string? 日期类型,
        string? 领料备注,
        string? 物料类别)
    {
        var dateColumn = 日期类型 switch
        {
            "开单日期" => "q.[开单日期]",
            "领料日期" => "q.[最后领料日期]",
            _ => null,
        };
        var dateWhere = dateColumn is not null && 起.HasValue && 止.HasValue
            ? $" AND {dateColumn} >= @start AND {dateColumn} < @end"
            : "";
        var status = Exact(到货情况);

        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryIssueProgressRow>($@"
WITH 需求 AS (
    SELECT
        h.[日期] AS 开单日期,
        mo.[生产单号] AS 装配生产单号,
        h.[款号] AS 产品货号,
        d.[物料编号] AS 辅料编号,
        MAX(d.[物料名称]) AS 辅料名称,
        MAX(d.[规格]) AS 规格,
        MAX(d.[单位]) AS 单位,
        SUM(COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0)) AS 需求数量,
        N'生产领料' AS 领料备注
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    WHERE d.[物料类别] = @category{SnapshotExcludeSql}
    GROUP BY h.[日期], mo.[生产单号], h.[款号], d.[物料编号]

    UNION ALL

    SELECT
        po.[日期] AS 开单日期,
        sd.[生产单号] AS 装配生产单号,
        sd.[款号] AS 产品货号,
        sd.[物料编号] AS 辅料编号,
        MAX(sd.[物料名称]) AS 辅料名称,
        MAX(m.[规格]) AS 规格,
        MAX(sd.[单位]) AS 单位,
        SUM(ISNULL(sd.[需求数量], 0)) AS 需求数量,
        N'生产领料' AS 领料备注
    FROM [装配加工采购单明细] sd
    JOIN [装配加工采购单] po ON po.[单号] = sd.[单号]
    LEFT JOIN [物料资料] m ON m.[物料编号] = sd.[物料编号]
    WHERE m.[物料类别] = @category
    GROUP BY po.[日期], sd.[生产单号], sd.[款号], sd.[物料编号]
),
领料 AS (
    SELECT
        NULLIF(d.[生产单号], N'') AS 装配生产单号,
        NULLIF(d.[款号], N'') AS 产品货号,
        d.[物料编号] AS 辅料编号,
        COALESCE(
            MAX(NULLIF(CONVERT(nvarchar(4000), d.[备注]), N'')),
            MAX(NULLIF(CONVERT(nvarchar(4000), o.[备注]), N'')),
            N'生产领料'
        ) AS 领料备注,
        SUM(ISNULL(d.[数量], 0)) AS 已领数量,
        MAX(o.[日期]) AS 最后领料日期,
        MAX(o.[操作员]) AS 操作员
    FROM [领料明细单] d
    JOIN [领料单] o ON o.[单号] = d.[单号]
    WHERE ISNULL(o.[审核], N'0') = N'1'
      AND d.[物料类别] = @category
    GROUP BY NULLIF(d.[生产单号], N''), NULLIF(d.[款号], N''), d.[物料编号]
),
汇总 AS (
    SELECT
        q.[开单日期],
        q.[装配生产单号],
        COALESCE(NULLIF(l.[领料备注], N''), q.[领料备注]) AS 领料备注,
        q.[辅料编号],
        q.[辅料名称],
        q.[规格],
        q.[单位],
        q.[需求数量],
        ISNULL(l.[已领数量], 0) AS 已领数量,
        q.[需求数量] - ISNULL(l.[已领数量], 0) AS 未领数量,
        l.[操作员],
        l.[最后领料日期]
    FROM 需求 q
    OUTER APPLY (
        SELECT
            MAX(l.[领料备注]) AS 领料备注,
            SUM(l.[已领数量]) AS 已领数量,
            MAX(l.[最后领料日期]) AS 最后领料日期,
            MAX(l.[操作员]) AS 操作员
        FROM 领料 l
        WHERE l.[辅料编号] = q.[辅料编号]
          AND (
              (l.[装配生产单号] IS NOT NULL AND l.[装配生产单号] = q.[装配生产单号])
              OR (l.[产品货号] IS NOT NULL AND l.[产品货号] = q.[产品货号])
          )
    ) l
)
SELECT
    q.[开单日期],
    q.[装配生产单号],
    q.[领料备注],
    q.[辅料编号],
    q.[辅料名称],
    q.[规格],
    q.[单位],
    q.[需求数量],
    q.[已领数量],
    q.[未领数量],
    q.[操作员]
FROM 汇总 q
WHERE (@kw IS NULL
       OR q.[装配生产单号] LIKE @kw
       OR q.[领料备注] LIKE @kw
       OR q.[辅料编号] LIKE @kw
       OR q.[辅料名称] LIKE @kw
       OR q.[规格] LIKE @kw
       OR q.[操作员] LIKE @kw)
  AND (@remark IS NULL OR q.[领料备注] = @remark)
  {dateWhere}
  AND (@onlyOwed = 0 OR q.[未领数量] > 0)
  AND (@onlyDone = 0 OR q.[未领数量] <= 0)
ORDER BY q.[开单日期] DESC, q.[装配生产单号], q.[辅料编号];", new
        {
            start = 起?.Date,
            end = 止?.Date.AddDays(1),
            kw = Like(keyword),
            category = Exact(物料类别) ?? "辅料资料",
            remark = Exact(领料备注),
            onlyOwed = status == "未到" ? 1 : 0,
            onlyDone = status == "已到" ? 1 : 0,
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AssemblyFactoryCategoryMonthlyRow>> FactoryCategoryMonthlyAsync(
        DateTime 起,
        DateTime 止,
        string? 加工厂,
        string? keyword)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<AssemblyFactoryCategoryMonthlyRow>($@"
WITH src AS (
    SELECT
        prod.[加工厂编号],
        prod.[加工厂名称],
        CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
        ISNULL(NULLIF(d.[物料类别], N''), N'未分类') AS 物料分类,
        h.[款号] AS 产品货号,
        d.[物料编号],
        COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) AS 领料数量,
        CAST(0 AS decimal(18,4)) AS 送货数量,
        h.[日期] AS 日期
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [产品名称], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    OUTER APPLY (
        SELECT TOP 1 [加工厂编号], [加工厂名称]
        FROM [生产制单] p
        WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
        ORDER BY p.[ID] DESC
    ) prod
    WHERE h.[日期] >= @start AND h.[日期] < @end
      AND (@factory IS NULL OR prod.[加工厂编号] LIKE @factory OR prod.[加工厂名称] LIKE @factory)
      AND (@kw IS NULL
           OR h.[款号] LIKE @kw
           OR h.[款式] LIKE @kw
           OR h.[产品编号] LIKE @kw
           OR mo.[生产单号] LIKE @kw
           OR prod.[加工厂编号] LIKE @kw
           OR prod.[加工厂名称] LIKE @kw
           OR d.[物料类别] LIKE @kw
           OR d.[物料编号] LIKE @kw
           OR d.[物料名称] LIKE @kw){SnapshotExcludeSql}

    UNION ALL

    SELECT
        po.[供应商编号] AS 加工厂编号,
        po.[供应商名称] AS 加工厂名称,
        po.[收货仓库],
        ISNULL(NULLIF(m.[物料类别], N''), N'未分类') AS 物料分类,
        sd.[款号] AS 产品货号,
        sd.[物料编号],
        ISNULL(sd.[需求数量], 0) AS 领料数量,
        CAST(0 AS decimal(18,4)) AS 送货数量,
        po.[日期] AS 日期
    FROM [装配加工采购单明细] sd
    JOIN [装配加工采购单] po ON po.[单号] = sd.[单号]
    LEFT JOIN [物料资料] m ON m.[物料编号] = sd.[物料编号]
    WHERE po.[日期] >= @start AND po.[日期] < @end
      AND (@factory IS NULL OR po.[供应商编号] LIKE @factory OR po.[供应商名称] LIKE @factory)
      AND (@kw IS NULL
           OR sd.[款号] LIKE @kw
           OR sd.[物料编号] LIKE @kw
           OR sd.[物料名称] LIKE @kw
           OR m.[物料类别] LIKE @kw
           OR po.[供应商编号] LIKE @kw
           OR po.[供应商名称] LIKE @kw)
)
SELECT
    加工厂编号,
    加工厂名称,
    收货仓库,
    物料分类,
    COUNT(DISTINCT 产品货号) AS 产品款数,
    COUNT(DISTINCT 物料编号) AS 物料款数,
    SUM(领料数量) AS 领料数量,
    SUM(送货数量) AS 送货数量,
    SUM(领料数量) - SUM(送货数量) AS 库存数量,
    MIN(日期) AS 起始日期,
    MAX(日期) AS 截止日期
FROM src
GROUP BY 加工厂编号, 加工厂名称, 收货仓库, 物料分类
ORDER BY 加工厂编号, 加工厂名称, 物料分类;", new
        {
            start = 起.Date,
            end = 止.Date.AddDays(1),
            factory = Like(加工厂),
            kw = Like(keyword),
        });
        return rows.AsList();
    }

    public async Task<AssemblyPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        if (string.IsNullOrWhiteSpace(单号)) return null;
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT TOP 1
    CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 单号,
    prod.[加工厂编号] AS 供应商编号,
    prod.[加工厂名称] AS 供应商名称,
    h.[日期] AS 出单日期,
    ISNULL(price.[单价], 0) AS 单价,
    COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(price.[单价], 0) AS 金额,
    CASE WHEN COALESCE(h.[制作要求], N'') LIKE N'%半成品%' THEN N'半成品仓' ELSE N'成品仓' END AS 收货仓库,
    CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) AS 电脑单号,
    COALESCE(h.[客户名称], h.[客户], h.[客户编号]) AS 客户,
    h.[备注],
    h.[日期] AS 开始交货日期,
    CAST(0 AS decimal(18,4)) AS 每天交货,
    CAST(NULL AS datetime) AS 完成日期,
    CAST(NULL AS nvarchar(80)) AS 收货人,
    h.[审核]
FROM [款号物料总表] h
OUTER APPLY (
    SELECT TOP 1 [生产单号], [接单数量]
    FROM [生产通知单MO单] mo
    WHERE mo.[产品货号] = h.[款号]
    ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
) mo
OUTER APPLY (
    SELECT TOP 1 [加工厂编号], [加工厂名称]
    FROM [生产制单] p
    WHERE p.[生产单号] = mo.[生产单号] OR p.[款号] = h.[款号]
    ORDER BY p.[ID] DESC
) prod
OUTER APPLY (
    SELECT TOP 1 [单价]
    FROM [款号总表] k
    WHERE k.[款号] = h.[款号]
    ORDER BY k.[ID] DESC
) price
WHERE CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) = @单号;

SELECT TOP 1
    COALESCE(h.[客户名称], h.[客户], h.[客户编号]) AS 客户,
    h.[款号] AS 产品货号,
    h.[款式] AS 产品装配名称,
    h.[产品编号] AS 配件编号,
    h.[制作要求] AS 装配方式,
    COALESCE(mo.[接单数量], h.[使用数量], 0) AS 加工数量,
    h.[备注]
FROM [款号物料总表] h
OUTER APPLY (
    SELECT TOP 1 [生产单号], [接单数量]
    FROM [生产通知单MO单] mo
    WHERE mo.[产品货号] = h.[款号]
    ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
) mo
WHERE CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) = @单号;

SELECT
    mo.[接单日期],
    mo.[生产单号],
    h.[款号] AS 产品货号,
    COALESCE(mo.[产品名称], h.[款式]) AS 产品名称,
    h.[产品编号] AS 配件编号,
    h.[款式] AS 产品装配名称,
    COALESCE(mo.[接单数量], h.[使用数量], 0) AS 加工数量,
    ISNULL(price.[单价], 0) AS 单价,
    COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(price.[单价], 0) AS 金额
FROM [款号物料总表] h
LEFT JOIN [生产通知单MO单] mo ON mo.[产品货号] = h.[款号]
OUTER APPLY (
    SELECT TOP 1 [单价]
    FROM [款号总表] k
    WHERE k.[款号] = h.[款号]
    ORDER BY k.[ID] DESC
) price
WHERE CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) = @单号
ORDER BY mo.[接单日期] DESC, mo.[ID] DESC;

SELECT
    CAST(ROW_NUMBER() OVER (ORDER BY d.[顺序], d.[ID]) AS int) AS 序号,
    d.[物料编号] AS 辅料编号,
    d.[物料名称] AS 辅料名称,
    COALESCE(mo.[接单数量], h.[使用数量], 0) AS 加工总数量,
    d.[使用数量] AS 单个产品需求量,
    CASE WHEN d.[单位] LIKE N'%g%' OR d.[单位] LIKE N'%克%' THEN COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) ELSE CAST(NULL AS decimal(18,4)) END AS 需求数克,
    CASE WHEN d.[单位] LIKE N'%g%' OR d.[单位] LIKE N'%克%' THEN CAST(NULL AS decimal(18,4)) ELSE COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0) END AS 需求数个
FROM [款号物料总表] h
JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
OUTER APPLY (
    SELECT TOP 1 [接单数量]
    FROM [生产通知单MO单] mo
    WHERE mo.[产品货号] = h.[款号]
    ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
) mo
WHERE CONCAT(N'ZP', CONVERT(nvarchar(20), h.[ID])) = @单号
ORDER BY d.[顺序], d.[ID];", new { 单号 });

        var head = await multi.ReadFirstOrDefaultAsync<AssemblyPurchaseOrderHeaderDto>();
        if (head is null) return null;
        var products = (await multi.ReadAsync<AssemblyPurchaseProductLineDto>()).AsList();
        var production = (await multi.ReadAsync<AssemblyPurchaseProductionLineDto>()).AsList();
        var accessories = (await multi.ReadAsync<AssemblyPurchaseAccessoryLineDto>()).AsList();

        if (production.Count == 0 && products.Count > 0)
        {
            var p = products[0];
            production.Add(new AssemblyPurchaseProductionLineDto
            {
                产品货号 = p.产品货号,
                产品名称 = p.产品装配名称,
                配件编号 = p.配件编号,
                产品装配名称 = p.产品装配名称,
                加工数量 = p.加工数量,
                单价 = head.单价,
                金额 = head.金额,
            });
        }

        return new AssemblyPurchaseOrderDetailDto
        {
            单头 = head,
            产品明细 = products,
            生产明细 = production,
            辅料表 = accessories,
        };
    }
}
