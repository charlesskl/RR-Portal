using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials;

// 个人库存金额表:把当前库存按「谁下单归谁」拆到个人。
// 算法 = 批次倒推 FIFO:净库存口径与 MaterialInventoryService/PlasticInventoryService 的符号台账完全一致,
// 剩余库存优先占最新入仓批次(等价于先进先出消耗);批次下单人取 订单.操作员,无订单回落入仓单.操作员。
// 库存超出批次总量的部分(期初/盘点盈余等)归为「期初结余」。
// 单价/金额受权限位控制:无「单价」位单价返回 null,无「金额」位金额返回 null。
[ApiController]
[Authorize]
[Route("api/personal-inventory")]
public sealed class PersonalInventoryController(ISqlConnectionFactory factory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "个人库存金额表";
    private string CurrentUser => User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? User?.FindFirstValue("sub") ?? "";

    // 来料仓:净库存台账(与 MaterialInventoryService.LedgerUnion 同口径,仅取 物料编号+数量)
    private const string MaterialLedger = @"
SELECT d.[物料编号], ISNULL(d.[数量],0)+ISNULL(d.[备品数量],0) AS q
    FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[数量],0)
    FROM [退料明细单] d JOIN [退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -(CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE ISNULL(d.[数量],0) END)
    FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(d.[已出数量],0) > 0 OR ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [采购退仓明细单] d JOIN [采购退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [报废明细单] d JOIN [报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(CAST(d.[盈亏数量] AS decimal(18,4)),0)
    FROM [盘点明细单] d JOIN [盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    // 来料仓:入仓批次(采购入仓 下单人=订单操作员;退料回库 归退料单操作员)
    private const string MaterialBatches = @"
SELECT d.[ID] AS bid, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[仓库],
       d.[单号] AS 入仓单号, d.[订单单号], COALESCE(d.[日期],h.[日期]) AS 日期,
       ISNULL(d.[数量],0)+ISNULL(d.[备品数量],0) AS 批次数量,
       COALESCE(d.[单价], m.[单价], 0) AS 单价,
       COALESCE(NULLIF(o.[操作员],''), NULLIF(h.[操作员],''), N'未知') AS 下单人
  FROM [采购入仓明细单] d
  JOIN [采购入仓单] h ON h.[单号]=d.[单号]
  LEFT JOIN [采购订单] o ON o.[单号]=d.[订单单号]
  LEFT JOIN (SELECT [物料编号], MAX([单价]) AS 单价 FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=d.[物料编号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0)+ISNULL(d.[备品数量],0) > 0
UNION ALL
SELECT d.[ID] + 1000000000, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[仓库],
       d.[单号], NULL, COALESCE(d.[日期],h.[日期]), ISNULL(d.[数量],0),
       COALESCE(d.[单价], m.[单价], 0),
       COALESCE(NULLIF(h.[操作员],''), N'未知')
  FROM [退料明细单] d
  JOIN [退料单] h ON h.[单号]=d.[单号]
  LEFT JOIN (SELECT [物料编号], MAX([单价]) AS 单价 FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=d.[物料编号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0) > 0";

    // 塑胶仓:净库存台账(与 PlasticInventoryService.LedgerUnion 同口径 7 支)
    private const string PlasticLedger = @"
SELECT d.[物料编号], ISNULL(d.[数量],0) AS q
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [白件领料明细单] d JOIN [白件领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[数量],0)
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], -ISNULL(d.[数量],0)
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(CAST(d.[盈亏数量] AS decimal(18,4)),0)
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    // 塑胶仓:入仓批次(塑胶入仓 下单人=塑胶采购订单操作员;塑胶退料 归退料单操作员)
    private const string PlasticBatches = @"
SELECT d.[ID] AS bid, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[仓库],
       d.[单号] AS 入仓单号, d.[订单单号], COALESCE(d.[日期],h.[日期]) AS 日期,
       ISNULL(d.[数量],0) AS 批次数量,
       COALESCE(d.[单价], m.[单价], 0) AS 单价,
       COALESCE(NULLIF(o.[操作员],''), NULLIF(h.[操作员],''), N'未知') AS 下单人
  FROM [塑胶入仓明细单] d
  JOIN [塑胶入仓单] h ON h.[单号]=d.[单号]
  LEFT JOIN [塑胶采购订单] o ON o.[单号]=d.[订单单号]
  LEFT JOIN (SELECT [物料编号], MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=d.[物料编号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0) > 0
UNION ALL
SELECT d.[ID] + 1000000000, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[仓库],
       d.[单号], NULL, COALESCE(d.[日期],h.[日期]), ISNULL(d.[数量],0),
       COALESCE(d.[单价], m.[单价], 0),
       COALESCE(NULLIF(h.[操作员],''), N'未知')
  FROM [塑胶退料明细单] d
  JOIN [塑胶退料单] h ON h.[单号]=d.[单号]
  LEFT JOIN (SELECT [物料编号], MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=d.[物料编号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0) > 0";

    // 半成品仓:净库存台账(与 InventorySummaryService.SemiSql 同口径 7 支;按 物料编号x颜色 分桶,颜色空值归一)
    private const string SemiLedger = @"
SELECT d.[物料编号], ISNULL(d.[颜色],N'') AS 颜色, ISNULL(d.[数量],0) AS q
    FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), -ISNULL(d.[数量],0)
    FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), -ISNULL(d.[数量],0)
    FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), ISNULL(CAST(d.[盈亏数量] AS decimal(18,4)),0)
    FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), ISNULL(d.[数量],0)
    FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), -ISNULL(d.[数量],0)
    FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号], ISNULL(d.[颜色],N''), -(CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE ISNULL(d.[数量],0) END)
    FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
    WHERE d.[仓库]=N'半成品仓' AND (ISNULL(d.[已出数量],0)>0 OR ISNULL(h.[审核],'0')='1')";

    // 半成品仓:入仓批次(挂委托加工单(装配加工采购单)的,下单人=订单操作员;退库回仓 归退库单操作员)
    private const string SemiBatches = @"
SELECT d.[ID] AS bid, d.[物料编号], COALESCE(d.[物料名称], d.[名称]) AS 物料名称, d.[规格], ISNULL(d.[颜色],N'') AS 颜色,
       d.[单位], d.[仓库], d.[单号] AS 入仓单号, d.[订单单号], COALESCE(d.[日期],h.[日期]) AS 日期,
       ISNULL(d.[数量],0) AS 批次数量, ISNULL(d.[单价],0) AS 单价,
       COALESCE(NULLIF(o.[操作员],''), NULLIF(h.[操作员],''), N'未知') AS 下单人
  FROM [半成品入仓明细单] d
  JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
  LEFT JOIN [装配加工采购单] o ON o.[单号]=d.[订单单号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0) > 0
UNION ALL
SELECT d.[ID] + 1000000000, d.[物料编号], d.[物料名称], d.[规格], ISNULL(d.[颜色],N''),
       d.[单位], d.[仓库], d.[单号], d.[订单单号], COALESCE(d.[日期],h.[日期]), ISNULL(d.[数量],0),
       ISNULL(d.[单价],0), COALESCE(NULLIF(h.[操作员],''), N'未知')
  FROM [半成品退库明细单] d
  JOIN [半成品退库单] h ON h.[单号]=d.[单号]
  WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[数量],0) > 0";

    // 半成品 FIFO(按 物料编号x颜色 分桶;无单价主档,期初结余的名称/单价取自该物料最新批次)
    private const string SemiFifoSql = @"
WITH stock AS (
    SELECT [物料编号], [颜色], SUM(q) AS 库存 FROM ({0}) t GROUP BY [物料编号], [颜色] HAVING SUM(q) > 0
),
ranked AS (
    SELECT b.*, SUM(批次数量) OVER (PARTITION BY [物料编号], [颜色] ORDER BY [日期] DESC, bid DESC) AS 新到旧累计
    FROM ({1}) b
),
remain AS (
    SELECT r.*, CAST(CASE WHEN s.[库存] >= 新到旧累计 THEN 批次数量
                          WHEN s.[库存] > 新到旧累计 - 批次数量 THEN s.[库存] - (新到旧累计 - 批次数量)
                          ELSE 0 END AS decimal(18,4)) AS 剩余数量
    FROM ranked r JOIN stock s ON s.[物料编号]=r.[物料编号] AND s.[颜色]=r.[颜色]
),
u AS (
    SELECT * FROM remain WHERE 剩余数量 > 0
    UNION ALL
    SELECT NULL, s.[物料编号],
           COALESCE(b2.[物料名称], s.[物料编号]), b2.[规格], s.[颜色], b2.[单位], NULL,
           NULL, NULL, NULL,
           s.[库存] - ISNULL(b.[批次总量],0),
           COALESCE(b2.[单价], 0), N'期初结余', CAST(0 AS decimal(18,4)), s.[库存] - ISNULL(b.[批次总量],0)
    FROM stock s
    LEFT JOIN (SELECT [物料编号], [颜色], SUM(批次数量) AS 批次总量 FROM ({1}) bg GROUP BY [物料编号], [颜色]) b
           ON b.[物料编号]=s.[物料编号] AND b.[颜色]=s.[颜色]
    OUTER APPLY (SELECT TOP 1 [物料名称],[规格],[单位],[单价] FROM ({1}) bm
                  WHERE bm.[物料编号]=s.[物料编号] AND bm.[颜色]=s.[颜色] ORDER BY [日期] DESC, bid DESC) b2
    WHERE s.[库存] > ISNULL(b.[批次总量],0)
)
SELECT N'半成品' AS [范围], u.* FROM u ORDER BY u.[物料编号], u.[日期] DESC";

    private const string FifoSql = @"
WITH stock AS (
    SELECT [物料编号], SUM(q) AS 库存 FROM ({0}) t GROUP BY [物料编号] HAVING SUM(q) > 0
),
ranked AS (
    SELECT b.*, SUM(批次数量) OVER (PARTITION BY [物料编号] ORDER BY [日期] DESC, bid DESC) AS 新到旧累计
    FROM ({1}) b
),
remain AS (
    SELECT r.*, CAST(CASE WHEN s.[库存] >= 新到旧累计 THEN 批次数量
                          WHEN s.[库存] > 新到旧累计 - 批次数量 THEN s.[库存] - (新到旧累计 - 批次数量)
                          ELSE 0 END AS decimal(18,4)) AS 剩余数量
    FROM ranked r JOIN stock s ON s.[物料编号]=r.[物料编号]
),
u AS (
    SELECT * FROM remain WHERE 剩余数量 > 0
    UNION ALL
    -- 期初/无批次结余:净库存超出已登记批次总量的部分
    SELECT NULL, s.[物料编号],
           COALESCE(m.[物料名称], s.[物料编号]), m.[规格], m.[颜色], m.[单位], NULL,
           NULL, NULL, NULL,
           s.[库存] - ISNULL(b.[批次总量],0),
           COALESCE(m.[单价], 0), N'期初结余', CAST(0 AS decimal(18,4)), s.[库存] - ISNULL(b.[批次总量],0)
    FROM stock s
    LEFT JOIN (SELECT [物料编号], SUM(批次数量) AS 批次总量 FROM ({1}) bg GROUP BY [物料编号]) b ON b.[物料编号]=s.[物料编号]
    LEFT JOIN (SELECT [物料编号], MAX([物料名称]) AS 物料名称, MAX([规格]) AS 规格, MAX([颜色]) AS 颜色,
                      MAX([单位]) AS 单位, MAX([单价]) AS 单价 FROM [{2}] GROUP BY [物料编号]) m ON m.[物料编号]=s.[物料编号]
    WHERE s.[库存] > ISNULL(b.[批次总量],0)
)
SELECT N'{3}' AS [范围], u.* FROM u ORDER BY u.[物料编号], u.[日期] DESC";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "范围")] string? 范围 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var canPrice = await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);
        var canAmount = await perms.HasAsync(CurrentUser, Menu, PermissionAction.金额);

        var rows = new List<PersonalInventoryBatchRow>();
        using var c = factory.Create();
        if (范围 is null or "" or "全部" or "来料")
            rows.AddRange(await c.QueryAsync<PersonalInventoryBatchRow>(
                string.Format(FifoSql, MaterialLedger, MaterialBatches, "物料资料", "来料")));
        // 塑胶批次 bid 与来料可能重叠(不同表),前端不用 bid 做 key,无需再偏移
        if (范围 is null or "" or "全部" or "塑胶")
            rows.AddRange(await c.QueryAsync<PersonalInventoryBatchRow>(
                string.Format(FifoSql, PlasticLedger, PlasticBatches, "塑胶物料资料", "塑胶")));
        if (范围 is null or "" or "全部" or "半成品")
            rows.AddRange(await c.QueryAsync<PersonalInventoryBatchRow>(
                string.Format(SemiFifoSql, SemiLedger, SemiBatches)));

        foreach (var r in rows)
        {
            // 金额=剩余x单价,先算后按权限位遮罩(单价位只管单价列)
            r.金额 = Math.Round((r.单价 ?? 0) * r.剩余数量, 2);
            if (!canPrice) r.单价 = null;
            if (!canAmount) r.金额 = null;
        }
        return Ok(rows);
    }
}

public sealed class PersonalInventoryBatchRow
{
    public string? 范围 { get; set; }
    public string 下单人 { get; set; } = "";
    public string? 入仓单号 { get; set; }
    public string? 订单单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 仓库 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 批次数量 { get; set; }
    public decimal 剩余数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
