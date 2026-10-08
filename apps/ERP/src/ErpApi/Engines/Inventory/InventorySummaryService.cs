using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Inventory;

public sealed class InventorySummaryService(ISqlConnectionFactory factory) : IInventorySummaryService
{
    // 算法1：入 +数量 / 出 −数量，UNION ALL 后按 款号×色号×颜色×尺码 group sum，仅 审核='1'。
    // 成品口径：入仓(+)、退货(+客户退回)、出仓(-)、退仓(-)、盘点盈亏(±)、调拨(调入+/调出-)；
    // 装配部领料单(仓库=成品仓,如返工领出)出库也扣减，扣减口径同物料台账：已出数量 优先，未审单只看 已出数量>0。
    private const string Sql = @"
SELECT 款号, MAX(款式) AS 款式, 色号, 颜色, 尺码, SUM(库存) AS 库存
FROM (
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品退货明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品出仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品退仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 盈亏数量     AS 库存 FROM [成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品调拨明细单] WHERE 目标仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品调拨明细单] WHERE 源仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.款号, N'' AS 款式, CAST(NULL AS nvarchar(20)) AS 色号, d.颜色, CAST(NULL AS nvarchar(10)) AS 尺码,
           (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1 AS 库存
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
) t
GROUP BY 款号,色号,颜色,尺码
HAVING SUM(库存) <> 0;";

    public async Task<IReadOnlyList<InventoryRow>> FinishedGoodsAsync(string warehouse)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<InventoryRow>(Sql, new { 仓 = warehouse });
        return rows.AsList();
    }

    // 半成品口径：入仓(+)、领料(-)、盘点盈亏(±)，按 物料编号×颜色 group，仅审核'1'。
    // 装配部领料单(仓库=半成品仓,半成品再领出做成品)出库也扣减，扣减口径同物料台账：已出数量 优先，未审单只看 已出数量>0。
    // 注意：半成品各明细单无 审核 列（与成品不同），审核状态在主单上，故 JOIN 主单按 单号 取 审核。
    // 盘点 系统/盘点/盈亏数量列为 real，CAST 对齐 decimal。
    private const string SemiSql = @"
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, 颜色, SUM(库存) AS 库存
FROM (
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量        AS 库存
      FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
      SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量*-1     AS 库存
        FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.单号=d.单号
        WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
      UNION ALL
      SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量*-1     AS 库存
        FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色, CAST(d.盈亏数量 AS decimal(18,4)) AS 库存
      FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量        AS 库存
      FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量*-1     AS 库存
      FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,
           (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1 AS 库存
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
) t
GROUP BY 物料编号, 颜色
HAVING SUM(库存) <> 0;";

    public async Task<IReadOnlyList<SemiFinishedRow>> SemiFinishedAsync(string warehouse)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<SemiFinishedRow>(SemiSql, new { 仓 = warehouse });
        return rows.AsList();
    }

    // 玩具模型口径：按 配件编号 聚合，来源与算法1相同（8 个来源 UNION ALL，仅 审核='1'）。
    // 只有 成品入仓明细单 带玩具列(配件编号/客户/货号/名称/产品装配名称)，其余来源只有 款号；
    // 故用 入仓映射(款号→配件编号) 归并：key=COALESCE(明细自带配件编号, 映射配件编号, 款号)。
    // 非入仓来源描述列给 NULL，外层 GROUP BY key 后 MAX 取入仓行提供的描述。
    private const string ByItemSql = @"
WITH map AS (
    SELECT [款号], MAX([配件编号]) AS [配件编号]
    FROM [成品入仓明细单]
    WHERE NULLIF(LTRIM(RTRIM([配件编号])), N'') IS NOT NULL
    GROUP BY [款号]
)
SELECT t.[key] AS [配件编号], MAX(t.[客户]) AS [客户], MAX(t.[产品货号]) AS [产品货号],
       MAX(t.[产品名称]) AS [产品名称], MAX(t.[产品装配名称]) AS [产品装配名称], SUM(t.[库存]) AS [库存数量]
FROM (
    SELECT COALESCE(NULLIF(LTRIM(RTRIM(d.[配件编号])),N''), m.[配件编号], d.[款号]) AS [key],
           d.[客户], d.[货号] AS [产品货号], d.[名称] AS [产品名称], d.[产品装配名称], d.[数量] AS [库存]
      FROM [成品入仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[数量]
      FROM [成品退货明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[数量]*-1
      FROM [成品出仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[数量]*-1
      FROM [成品退仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[盈亏数量]
      FROM [成品盘点明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[数量]
      FROM [成品调拨明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[目标仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL, d.[数量]*-1
      FROM [成品调拨明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[源仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT COALESCE(m.[配件编号], d.[款号]), NULL, NULL, NULL, NULL,
           (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END)*-1
      FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
      LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND (ISNULL(d.[已出数量],0)>0 OR ISNULL(h.[审核],'0')='1')
) t
GROUP BY t.[key]
HAVING SUM(t.[库存]) <> 0
ORDER BY t.[key];";

    public async Task<IReadOnlyList<FinishedItemStockRow>> FinishedGoodsByItemAsync(string warehouse)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<FinishedItemStockRow>(ByItemSql, new { 仓 = warehouse });
        return rows.AsList();
    }

    // 某配件编号在指定仓库的出入库流水，来源与汇总一致（8 个来源，仅 审核='1'）；
    // 盘点盈亏 正计入库、负计出库（取绝对值）；领料的日期/单号取主单。按 日期,单号 排序，结存由前端累计。
    private const string LedgerSql = @"
WITH map AS (
    SELECT [款号], MAX([配件编号]) AS [配件编号]
    FROM [成品入仓明细单]
    WHERE NULLIF(LTRIM(RTRIM([配件编号])), N'') IS NOT NULL
    GROUP BY [款号]
)
SELECT t.[日期], t.[单号], t.[类型], t.[入库数量], t.[出库数量]
FROM (
    SELECT d.[日期], d.[单号], N'成品入仓' AS [类型], d.[数量] AS [入库数量], CAST(NULL AS decimal(18,4)) AS [出库数量],
           COALESCE(NULLIF(LTRIM(RTRIM(d.[配件编号])),N''), m.[配件编号], d.[款号]) AS [key]
      FROM [成品入仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'成品退货', d.[数量], NULL,
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品退货明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'成品出仓', NULL, d.[数量],
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品出仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'成品退仓', NULL, d.[数量],
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品退仓明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'盘点盈亏',
           CASE WHEN d.[盈亏数量] >= 0 THEN d.[盈亏数量] END,
           CASE WHEN d.[盈亏数量] < 0 THEN d.[盈亏数量]*-1 END,
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品盘点明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'调拨调入', d.[数量], NULL,
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品调拨明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[目标仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[日期], d.[单号], N'调拨调出', NULL, d.[数量],
           COALESCE(m.[配件编号], d.[款号])
      FROM [成品调拨明细单] d LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[源仓库]=@仓 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT h.[日期], h.[单号], N'领料出库', NULL,
           CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END,
           COALESCE(m.[配件编号], d.[款号])
      FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
      LEFT JOIN map m ON m.[款号]=d.[款号]
      WHERE d.[仓库]=@仓 AND (ISNULL(d.[已出数量],0)>0 OR ISNULL(h.[审核],'0')='1')
) t
WHERE t.[key] = @key
ORDER BY t.[日期], t.[单号];";

    public async Task<IReadOnlyList<FinishedItemLedgerRow>> FinishedGoodsLedgerAsync(string warehouse, string itemKey)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<FinishedItemLedgerRow>(LedgerSql, new { 仓 = warehouse, key = itemKey });
        return rows.AsList();
    }
}
