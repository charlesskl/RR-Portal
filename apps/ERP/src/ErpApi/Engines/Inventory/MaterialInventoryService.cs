using Dapper;
using ErpApi.Features.Materials.MaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;

// 算法1（物料口径）：物料库存 = 采购入仓(+) + 退料(+) − 领料(−) − 采购退仓(−) − 报废(−) ± 盘点盈亏(±)，仅审核='1'，按 物料编号×仓库 汇总。
// 补料单不计入：补料走 采购入库→领料单 才扣库存（补料单本身只是采购申请，不碰库存）。
// 单据不维护余额——库存是已审核明细单的实时聚合（与成品库存引擎 InventorySummaryService 同哲学）。
public sealed class MaterialInventoryService(ISqlConnectionFactory factory) : IMaterialInventoryService
{
    // 三表符号法子查询（单一真相源；StockOfAsync 与 ListAsync 共用）。审核标志在单头，明细 JOIN 单头。
    // 领料单分支按 已出数量 计(分次出库:出库即扣库存,与单据审核无关;审核/反审核动作会同步 已出数量)。
    // 采购入仓分支按 数量+备品数量 计(备品是供应商多送的实物,入库存但不占订单欠数)。
    private const string LedgerUnion = @"
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], ISNULL(d.[数量],0)+ISNULL(d.[备品数量],0) AS 数量
    FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [退料明细单] d JOIN [退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库],
       (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END) * -1
    FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(d.[已出数量],0) > 0 OR ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [采购退仓明细单] d JOIN [采购退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [报废明细单] d JOIN [报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(d.[盈亏数量] AS decimal(18,4))
    FROM [盘点明细单] d JOIN [盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    private const string LedgerUnionDated = @"
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'入库' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(ISNULL(d.[数量],0)+ISNULL(d.[备品数量],0) AS decimal(18,4)) AS 数量
    FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'入库' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(ISNULL(d.[数量],0) AS decimal(18,4))
    FROM [退料明细单] d JOIN [退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'出库' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库],
       CAST((CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END) * -1 AS decimal(18,4))
    FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(d.[已出数量],0) > 0 OR ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'出库' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(ISNULL(d.[数量],0) * -1 AS decimal(18,4))
    FROM [采购退仓明细单] d JOIN [采购退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'出库' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(ISNULL(d.[数量],0) * -1 AS decimal(18,4))
    FROM [报废明细单] d JOIN [报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT COALESCE(d.[日期],h.[日期]) AS 日期, N'盘点' AS 方向,
       d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(ISNULL(d.[盈亏数量],0) AS decimal(18,4))
    FROM [盘点明细单] d JOIN [盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    public async Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope)
    {
        if (string.IsNullOrEmpty(物料编号)) return 0;
        // 单物料用外层 WHERE 过滤(物料单据量级小,SQL Server 会对 UNION ALL 做等值谓词下推);量级增大后可改为各分支内联 WHERE。
        var sql = $"SELECT ISNULL(SUM([数量]),0) FROM ({LedgerUnion}) t WHERE [物料编号]=@物料编号";
        if (scope is { } s)
            return await s.conn.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }, s.tx) ?? 0;
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }) ?? 0;
    }

    public async Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null, bool 含零库存 = false)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        // 含零库存口径：非零库存行（含不在主档的历史台账行）+ 主档中无库存的物料显 0。
        // 台账与主档 FULL OUTER JOIN：生产库存在游离台账行（FK not-trusted 导入未校验），主档 LEFT JOIN 会把它们整批丢掉。
        if (含零库存)
        {
            var sqlZero = $@"
WITH 账 AS (
    SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
           t.[仓库], SUM(t.[数量]) AS 库存数量
    FROM ({LedgerUnion}) t
    WHERE (@wh IS NULL OR t.[仓库]=@wh)
    GROUP BY t.[物料编号], t.[仓库]
    HAVING SUM(t.[数量]) <> 0
),
主档 AS (
    SELECT [物料编号], MAX([物料名称]) AS 物料名称, MAX([规格]) AS 规格, MAX([单位]) AS 单位,
           MAX([货号]) AS 货号, MAX([物料类别]) AS 物料类别,
           MAX([码换算]) AS 每单位数值, MAX([仓库位置]) AS 仓库位置
    FROM [物料资料]
    GROUP BY [物料编号]
)
SELECT COALESCE(z.[物料编号], m.[物料编号]) AS 物料编号,
       COALESCE(z.[物料名称], m.[物料名称]) AS 物料名称,
       COALESCE(z.[规格], m.[规格]) AS 规格,
       COALESCE(z.[单位], m.[单位]) AS 单位,
       COALESCE(z.[仓库], @wh, N'') AS 仓库,
       ISNULL(z.[库存数量], 0) AS 库存数量,
       m.[货号], m.[物料类别], m.[每单位数值], m.[仓库位置]
FROM 账 z
FULL OUTER JOIN 主档 m ON m.[物料编号]=z.[物料编号]
WHERE (@cat IS NULL OR m.[物料类别]=@cat)
  AND (@kw IS NULL OR COALESCE(z.[物料编号], m.[物料编号]) LIKE @kw
       OR COALESCE(z.[物料名称], m.[物料名称]) LIKE @kw
       OR COALESCE(z.[规格], m.[规格]) LIKE @kw)
ORDER BY 物料编号, 仓库";
            using var cz = factory.Create();
            var zeroRows = await cz.QueryAsync<MaterialStockRow>(sqlZero, new { wh, kw, cat });
            return zeroRows.AsList();
        }
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
       t.[仓库], SUM(t.[数量]) AS 库存数量,
       MAX(m.[货号]) AS 货号, MAX(m.[物料类别]) AS 物料类别,
       MAX(m.[码换算]) AS 每单位数值, MAX(m.[仓库位置]) AS 仓库位置
FROM ({LedgerUnion}) t
LEFT JOIN (SELECT [物料编号], MAX([货号]) AS 货号, MAX([物料类别]) AS 物料类别,
                  MAX([码换算]) AS 码换算, MAX([仓库位置]) AS 仓库位置
           FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别]=@cat)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(t.[数量]) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialStockRow>(sql, new { wh, kw, cat });
        return rows.AsList();
    }

    // 库存统计表左树：全部物料类别 + 各类别有库存(非零)的物料数（无库存的类别计数 0；新类别随物料资料自动出现）。
    public async Task<IReadOnlyList<MaterialCategoryNode>> CategoryCountsAsync()
    {
        var sql = $@"
WITH 账 AS (
    SELECT t.[物料编号], SUM(t.[数量]) AS 库存数量
    FROM ({LedgerUnion}) t
    GROUP BY t.[物料编号]
    HAVING SUM(t.[数量]) <> 0
)
SELECT m.[物料类别] AS 类别, COUNT(DISTINCT z.[物料编号]) AS 数量
FROM [物料资料] m
LEFT JOIN 账 z ON z.[物料编号]=m.[物料编号]
WHERE m.[物料类别] IS NOT NULL AND LTRIM(RTRIM(m.[物料类别])) <> ''
GROUP BY m.[物料类别]
ORDER BY m.[物料类别]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialCategoryNode>(sql);
        return rows.AsList();
    }

    public async Task<IReadOnlyList<MaterialMonthlyRow>> MonthlyAsync(DateTime 起, DateTime 止, string? 仓库, string? 物料类别 = null, string? keyword = null)
    {
        var qi = 起.Date;
        var end = 止.Date;
        if (end < qi) (qi, end) = (end, qi);
        var qe = end.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var sql = $@"
WITH 账本 AS (
    {LedgerUnionDated}
),
月报 AS (
    SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
           t.[仓库],
           SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) AS 期初库存,
           SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[方向]=N'入库' THEN t.[数量] ELSE 0 END) AS 本期入库,
           SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[方向]=N'出库' THEN -t.[数量] ELSE 0 END) AS 本期出库,
           SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[方向]=N'盘点' THEN t.[数量] ELSE 0 END) AS 盘点盈亏
    FROM 账本 t
    WHERE (@wh IS NULL OR t.[仓库]=@wh)
    GROUP BY t.[物料编号], t.[仓库]
),
主档 AS (
    SELECT [物料编号], MAX([物料名称]) AS 物料名称, MAX([规格]) AS 规格, MAX([单位]) AS 单位,
           MAX([物料类别]) AS 物料类别, MAX([码换算]) AS 每单位数值
    FROM [物料资料]
    GROUP BY [物料编号]
),
合并 AS (
    SELECT y.[物料编号],
           COALESCE(m.[物料名称], y.[物料名称]) AS 物料名称,
           COALESCE(m.[规格], y.[规格]) AS 规格,
           m.[每单位数值],
           COALESCE(m.[单位], y.[单位]) AS 单位,
           y.[期初库存],
           y.[本期入库],
           y.[本期出库],
           y.[盘点盈亏],
           y.[期初库存] + y.[本期入库] - y.[本期出库] + y.[盘点盈亏] AS 期末库存,
           y.[仓库],
           m.[物料类别]
    FROM 月报 y
    LEFT JOIN 主档 m ON m.[物料编号]=y.[物料编号]
)
SELECT [物料编号],[物料名称],[规格],[每单位数值],[单位],[期初库存],[本期入库],[本期出库],[盘点盈亏],[期末库存],[仓库],[物料类别]
FROM 合并
WHERE (@cat IS NULL OR [物料类别]=@cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw)
  AND ([期初库存] <> 0 OR [本期入库] <> 0 OR [本期出库] <> 0 OR [盘点盈亏] <> 0 OR [期末库存] <> 0)
ORDER BY [物料编号], [仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialMonthlyRow>(sql, new { qi, qe, wh, cat, kw });
        return rows.AsList();
    }
}
