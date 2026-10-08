using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;

public sealed class PlasticStockRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 库存数量 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 塑胶货号 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    // 已加工工序标记：该物料有已审核入仓(订单单号 指向 一次加工塑胶采购订单)时带出加工内容
    public string? 已加工工序 { get; set; }
}

public sealed class PlasticInOutRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 期初数量 { get; set; }
    public decimal 本期入库 { get; set; }
    public decimal 本期出库 { get; set; }
    public decimal 期末数量 { get; set; }
}

public sealed class PlasticRawMaterialSummaryRow
{
    public string? 原料名称 { get; set; }
    public decimal 本月库存重量 { get; set; }
    public decimal 存外厂重量 { get; set; }
    public decimal 本月报废重量 { get; set; }
    public decimal 本月总重量 { get; set; }
    public decimal 本月库存 { get; set; }
    public decimal 存外厂数量 { get; set; }
    public decimal 本月报废 { get; set; }
    public decimal 本月总数 { get; set; }
}

public sealed class PlasticRawMaterialStockRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 库存数量 { get; set; }
    public string? 物料类别 { get; set; }
    public bool 有发生 { get; set; }
}

public sealed class PlasticRawMaterialMonthlyRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 期初库存 { get; set; }
    public decimal 本期入库 { get; set; }
    public decimal 本期出库 { get; set; }
    public decimal 盘点盈亏 { get; set; }
    public decimal 期末库存 { get; set; }
    public decimal 外发库存 { get; set; }
    public string? 物料类别 { get; set; }
}

// 塑胶库存(口径=塑胶):入仓(+) / 领料(−) / 白件领料(发外喷油,固定塑胶仓 −) / 退料(+) / 退仓(−) / 报废(−) / 盘点(±)。仅审核='1',按 物料编号×仓库 汇总。
// 补料单不计入：补料走 采购入库→领料单 才扣库存（补料单本身只是采购申请，不碰库存）。
// 单据不维护余额——库存是已审核明细单的实时聚合(镜像 MaterialInventoryService)。
public sealed class PlasticInventoryService(ISqlConnectionFactory factory)
{
    private const string LedgerUnion = @"
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],CAST(NULL AS nvarchar(20)) AS [规格],d.[单位],N'塑胶仓' AS [仓库], d.[数量]*-1
    FROM [白件领料明细单] d JOIN [白件领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[盈亏数量]
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    // 带单据日期的签名台账(进出库统计用;仅审核='1')。与 LedgerUnion 同 7 支,多选 h.[日期]。
    private const string LedgerUnionDated = @"
SELECT h.[日期] AS 日期, d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],CAST(NULL AS nvarchar(20)),d.[单位],N'塑胶仓', d.[数量]*-1
    FROM [白件领料明细单] d JOIN [白件领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[盈亏数量]
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    private const string RawMaterialLedgerUnion = @"
SELECT d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量] AS 数量
    FROM [原料入仓明细单] d JOIN [原料入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]*-1
    FROM [原料退仓明细单] d JOIN [原料退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]*-1
    FROM [原料出库明细单] d JOIN [原料出库单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]
    FROM [原料退库明细单] d JOIN [原料退库表] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[盈亏数量]
    FROM [原料盘点明细单] d JOIN [原料盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    private const string RawMaterialLedgerUnionDated = @"
SELECT h.[日期] AS 日期, N'入库' AS 方向, d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量] AS 数量
    FROM [原料入仓明细单] d JOIN [原料入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'出库', d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]*-1
    FROM [原料退仓明细单] d JOIN [原料退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'出库', d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]*-1
    FROM [原料出库明细单] d JOIN [原料出库单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'入库', d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[数量]
    FROM [原料退库明细单] d JOIN [原料退库表] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'盘点', d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位], d.[盈亏数量]
    FROM [原料盘点明细单] d JOIN [原料盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    public async Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope)
    {
        if (string.IsNullOrEmpty(物料编号)) return 0;
        var sql = $"SELECT ISNULL(SUM([数量]),0) FROM ({LedgerUnion}) t WHERE [物料编号]=@物料编号";
        if (scope is { } s)
            return await s.conn.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }, s.tx) ?? 0;
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }) ?? 0;
    }

    // 原料实时库存(原料台账聚合;无发生时回落 塑胶原料资料.库存,同 RawMaterialStockAsync 口径)
    public async Task<decimal> RawMaterialStockOfAsync(string 原料编号)
    {
        if (string.IsNullOrEmpty(原料编号)) return 0;
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(@"
SELECT CASE WHEN COUNT(1) = 0 THEN ISNULL((SELECT MAX([库存]) FROM [塑胶原料资料] WHERE [物料编号]=@原料编号), 0)
            ELSE ISNULL(SUM(t.[数量]), 0) END
FROM (" + RawMaterialLedgerUnion + @") t WHERE t.[原料编号]=@原料编号", new { 原料编号 }) ?? 0;
    }

    public async Task<IReadOnlyList<PlasticStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
       t.[仓库], SUM(t.[数量]) AS 库存数量,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[仓位号]) AS 仓位号, MAX(m.[颜色]) AS 颜色,
       MAX(g.[工模编号]) AS 工模编号, MAX(g.[塑胶货号]) AS 塑胶货号,
       MAX(m.[单价]) AS 单价, SUM(t.[数量]) * ISNULL(MAX(m.[单价]), 0) AS 金额,
       MAX(sp.[已加工工序]) AS 已加工工序
FROM ({LedgerUnion}) t
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([仓位号]) AS 仓位号, MAX([颜色]) AS 颜色, MAX([单价]) AS 单价
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([工模编号]) AS 工模编号, MAX([塑胶货号]) AS 塑胶货号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) g ON g.[物料编号]=t.[物料编号]
LEFT JOIN (SELECT r.[物料编号], MAX(COALESCE(NULLIF(r.[加工内容],N''), NULLIF(o.[加工内容],N''))) AS 已加工工序
           FROM [塑胶入仓明细单] r
           JOIN [塑胶入仓单] h ON h.[单号]=r.[单号]
           JOIN [塑胶采购订单] o ON o.[单号]=r.[订单单号]
           WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(o.[加工类型],N'一次加工')=N'一次加工'
           GROUP BY r.[物料编号]) sp ON sp.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(t.[数量]) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStockRow>(sql, new { wh, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticInOutRow>> InOutAsync(DateTime 起, DateTime 止, string? 仓库, string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格,
       MAX(m.[颜色]) AS 颜色, MAX(m.[物料类别]) AS 物料类别, MAX(t.[单位]) AS 单位, t.[仓库],
       SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) AS 期初数量,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] > 0 THEN t.[数量] ELSE 0 END) AS 本期入库,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] < 0 THEN -t.[数量] ELSE 0 END) AS 本期出库
FROM ({LedgerUnionDated}) t
LEFT JOIN (SELECT [物料编号], MAX([颜色]) AS 颜色, MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) <> 0
    OR SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe THEN t.[数量] ELSE 0 END) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<PlasticInOutRow>(sql, new { qi, qe, wh, kw })).AsList();
        foreach (var r in rows) r.期末数量 = r.期初数量 + r.本期入库 - r.本期出库;
        return rows;
    }

    // 原料本月库存汇总:按物料名称 当前实时库存 + 本月报废(区间)。存外厂无源恒0;本月总数=库存+报废。
    public async Task<IReadOnlyList<PlasticRawMaterialSummaryRow>> RawMaterialMonthlySummaryAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        // 旧系统"原料本月库存汇总"口径:原料台账(入/退/出/退/盘,仅审核单)按原料名称汇总,
        // 重量=数量×每包重量;存外厂待发外单据上线后接,原料报废单暂无→0(塑胶件报废不属于原料口径)
        var sql = $@"
WITH 库存 AS (
    SELECT [原料名称],
           SUM(ISNULL([数量],0)) AS 本月库存,
           SUM(ISNULL([数量],0) * ISNULL([每包重量],0)) AS 本月库存重量
    FROM ({RawMaterialLedgerUnion}) t
    GROUP BY [原料名称]
)
SELECT [原料名称] AS 原料名称,
       [本月库存重量],
       CAST(0 AS decimal(18,4)) AS 存外厂重量,
       CAST(0 AS decimal(18,4)) AS 本月报废重量,
       [本月库存重量] AS 本月总重量,
       [本月库存],
       CAST(0 AS decimal(18,4)) AS 存外厂数量,
       CAST(0 AS decimal(18,4)) AS 本月报废,
       [本月库存] AS 本月总数
FROM 库存
WHERE (@kw IS NULL OR [原料名称] LIKE @kw)
  AND ([本月库存] <> 0 OR [本月库存重量] <> 0)
ORDER BY [原料名称]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialSummaryRow>(sql, new { qi, qe, kw });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialStockRow>> RawMaterialStockAsync(
        string? 物料类别, string? keyword, string displayMode)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var mode = string.IsNullOrWhiteSpace(displayMode) ? "occurred" : displayMode.Trim().ToLowerInvariant();
        var sql = $@"
WITH 单据库存 AS (
    SELECT [原料编号],
           MAX([原料名称]) AS 原料名称,
           MAX([产地]) AS 产地,
           MAX([每包重量]) AS 每包重量,
           MAX([单位]) AS 单位,
           SUM(ISNULL([数量],0)) AS 库存数量,
           COUNT(1) AS 发生次数
    FROM ({RawMaterialLedgerUnion}) t
    GROUP BY [原料编号]
),
库存 AS (
    SELECT COALESCE(m.[物料编号], s.[原料编号]) AS 原料编号,
           COALESCE(m.[物料名称], s.[原料名称]) AS 原料名称,
           COALESCE(m.[产地], s.[产地]) AS 产地,
           COALESCE(m.[每包重量], s.[每包重量]) AS 每包重量,
           COALESCE(m.[单位], s.[单位]) AS 单位,
           ISNULL(s.[库存数量], ISNULL(m.[库存], 0)) AS 库存数量,
           m.[物料类别],
           CAST(CASE WHEN s.[发生次数] IS NULL THEN 0 ELSE 1 END AS bit) AS 有发生
    FROM [塑胶原料资料] m
    FULL OUTER JOIN 单据库存 s ON s.[原料编号] = m.[物料编号]
)
SELECT [原料编号],[原料名称],[产地],[每包重量],[单位],[库存数量],[物料类别],[有发生]
FROM 库存
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [原料编号] LIKE @kw OR [原料名称] LIKE @kw OR [产地] LIKE @kw)
  AND (
      @mode = 'all'
      OR (@mode = 'occurred' AND [有发生] = 1)
      OR (@mode = 'stock' AND [库存数量] <> 0)
      OR (@mode = 'zero' AND [库存数量] = 0)
  )
ORDER BY [原料编号]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialStockRow>(sql, new { cat, kw, mode });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialMonthlyRow>> RawMaterialMonthlyAsync(
        DateTime 起, DateTime 止, string? 物料类别, string? keyword)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var sql = $@"
WITH 月报 AS (
    SELECT [原料编号],
           MAX([原料名称]) AS 原料名称,
           MAX([产地]) AS 产地,
           MAX([每包重量]) AS 每包重量,
           MAX([单位]) AS 单位,
           SUM(CASE WHEN [日期] < @qi THEN ISNULL([数量],0) ELSE 0 END) AS 期初库存,
           SUM(CASE WHEN [日期] >= @qi AND [日期] < @qe AND [方向]=N'入库' THEN ISNULL([数量],0) ELSE 0 END) AS 本期入库,
           SUM(CASE WHEN [日期] >= @qi AND [日期] < @qe AND [方向]=N'出库' THEN -ISNULL([数量],0) ELSE 0 END) AS 本期出库,
           SUM(CASE WHEN [日期] >= @qi AND [日期] < @qe AND [方向]=N'盘点' THEN ISNULL([数量],0) ELSE 0 END) AS 盘点盈亏
    FROM ({RawMaterialLedgerUnionDated}) t
    GROUP BY [原料编号]
),
合并 AS (
    SELECT COALESCE(m.[物料编号], y.[原料编号]) AS 原料编号,
           COALESCE(m.[物料名称], y.[原料名称]) AS 原料名称,
           COALESCE(m.[产地], y.[产地]) AS 产地,
           COALESCE(m.[每包重量], y.[每包重量]) AS 每包重量,
           COALESCE(m.[单位], y.[单位]) AS 单位,
           ISNULL(y.[期初库存], 0) AS 期初库存,
           ISNULL(y.[本期入库], 0) AS 本期入库,
           ISNULL(y.[本期出库], 0) AS 本期出库,
           ISNULL(y.[盘点盈亏], 0) AS 盘点盈亏,
           ISNULL(y.[期初库存], 0) + ISNULL(y.[本期入库], 0) - ISNULL(y.[本期出库], 0) + ISNULL(y.[盘点盈亏], 0) AS 期末库存,
           CAST(0 AS decimal(18,4)) AS 外发库存,
           m.[物料类别]
    FROM [塑胶原料资料] m
    FULL OUTER JOIN 月报 y ON y.[原料编号] = m.[物料编号]
)
SELECT [原料编号],[原料名称],[产地],[每包重量],[单位],[期初库存],[本期入库],[本期出库],[盘点盈亏],[期末库存],[外发库存],[物料类别]
FROM 合并
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [原料编号] LIKE @kw OR [原料名称] LIKE @kw OR [产地] LIKE @kw)
  AND ([期初库存] <> 0 OR [本期入库] <> 0 OR [本期出库] <> 0 OR [盘点盈亏] <> 0 OR [期末库存] <> 0 OR [外发库存] <> 0)
ORDER BY [原料编号]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialMonthlyRow>(sql, new { qi, qe, cat, kw });
        return rows.AsList();
    }

    // 带单据类型的签名台账(物料进出汇总用;仅审核='1')。数量一律为正,盘点支取盈亏数量(带符号)。白件领料并入「领料」。
    private const string LedgerUnionTyped = @"
SELECT h.[日期] AS 日期, N'入仓' AS 类型, d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'领料', d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[数量]
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'领料', d.[物料编号],d.[物料名称],CAST(NULL AS nvarchar(20)),d.[单位], d.[数量]
    FROM [白件领料明细单] d JOIN [白件领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'退料', d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'退仓', d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[数量]
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'报废', d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[数量]
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], N'盘点', d.[物料编号],d.[物料名称],d.[规格],d.[单位], d.[盈亏数量]
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    // 塑胶库存月报表:指定月份 按物料编号 期初/本期入库/本期出库/期末(口径同 InOutAsync,仅审核='1';
    // 盘点盈亏按正负计入入/出)。与 InOutAsync 差别:按物料聚合(不分仓库)、支持物料类别过滤。
    public async Task<IReadOnlyList<PlasticInOutRow>> MonthlyAsync(DateTime 月份, string? 物料类别, string? keyword)
    {
        var qi = new DateTime(月份.Year, 月份.Month, 1);
        var qe = qi.AddMonths(1);
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格,
       MAX(m.[颜色]) AS 颜色, MAX(m.[物料类别]) AS 物料类别, MAX(t.[单位]) AS 单位,
       SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) AS 期初数量,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] > 0 THEN t.[数量] ELSE 0 END) AS 本期入库,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] < 0 THEN -t.[数量] ELSE 0 END) AS 本期出库
FROM ({LedgerUnionDated}) t
LEFT JOIN (SELECT [物料编号], MAX([颜色]) AS 颜色, MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
GROUP BY t.[物料编号]
HAVING SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) <> 0
    OR SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe THEN t.[数量] ELSE 0 END) <> 0
ORDER BY t.[物料编号]";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<PlasticInOutRow>(sql, new { qi, qe, cat, kw })).AsList();
        foreach (var r in rows) r.期末数量 = r.期初数量 + r.本期入库 - r.本期出库;
        return rows;
    }

    // 塑胶物料进出汇总:按物料一行汇总区间内各单据类型数量(入仓/退仓/领料/退料/报废=该类型绝对合计,
    // 盘点盈亏=带符号合计)。区别于塑胶进出库统计表(期初/入/出/期末口径),仅审核='1'。
    public async Task<IReadOnlyList<PlasticInOutSummaryRow>> InOutSummaryAsync(DateTime 起, DateTime 止, string? 物料类别, string? keyword)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格,
       MAX(m.[颜色]) AS 颜色, MAX(m.[物料类别]) AS 物料类别, MAX(t.[单位]) AS 单位,
       SUM(CASE WHEN t.[类型]=N'入仓' THEN t.[数量] ELSE 0 END) AS 入仓,
       SUM(CASE WHEN t.[类型]=N'退仓' THEN t.[数量] ELSE 0 END) AS 退仓,
       SUM(CASE WHEN t.[类型]=N'领料' THEN t.[数量] ELSE 0 END) AS 领料,
       SUM(CASE WHEN t.[类型]=N'退料' THEN t.[数量] ELSE 0 END) AS 退料,
       SUM(CASE WHEN t.[类型]=N'报废' THEN t.[数量] ELSE 0 END) AS 报废,
       SUM(CASE WHEN t.[类型]=N'盘点' THEN t.[数量] ELSE 0 END) AS 盘点盈亏
FROM ({LedgerUnionTyped}) t
LEFT JOIN (SELECT [物料编号], MAX([颜色]) AS 颜色, MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE t.[日期] >= @qi AND t.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
GROUP BY t.[物料编号]
ORDER BY t.[物料编号]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticInOutSummaryRow>(sql, new { qi, qe, cat, kw });
        return rows.AsList();
    }
}

// 塑胶物料进出汇总行:按物料一行的各单据类型合计。
public sealed class PlasticInOutSummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal 入仓 { get; set; }
    public decimal 退仓 { get; set; }
    public decimal 领料 { get; set; }
    public decimal 退料 { get; set; }
    public decimal 报废 { get; set; }
    public decimal 盘点盈亏 { get; set; }
}
