using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.PurchaseOrder;

// 采购物料单/采购订单。两层：采购订单(单头) + 采购明细单(明细，主从 by 单号)。
// 基准来源：生产BOM物料清单(按生产单号带料，来料仓口径——不含塑胶类/未建档物料)。审核/反审核由过账引擎处理。
public sealed class PurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IMaterialInventoryService inventory)
{
    public const string DocType = "采购订单";
    public const string Prefix = "PO";   // 采购订单号 = PO + yyyyMMdd + 3位流水

    // 从生产单BOM带出采购基准行。
    // 来料仓口径：只留 物料资料已建档 且 物料类别不含「塑胶」的行(塑胶类/未建档物料归塑胶仓，见领料应领明细 档=塑胶)。
    // 顺带返回 生产制单.合同号(客户合同号即PO号，由前端自动填入采购订单表头) 与 已订数量(该生产单下 采购明细单 按 物料+颜色 累计，防重复下单)。
    // 可用库存 不用 BOM 快照(制单时点)，返回实时库存(库存引擎聚合)：库存够需求时前端默认不勾选下单。
    public async Task<IReadOnlyList<PurchaseOrderBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        // 分析门:生产通知单(采购分析源单)必须已审核,且采购分析已审核(采购物料分析页独立审核层)
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        if (审核 is null) throw new KeyNotFoundException($"生产通知单 {生产单号} 不存在。");
        if (审核 != "1") throw new InvalidOperationException($"生产通知单 {生产单号} 未审核，审核后才能采购下单。");
        var 分析审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购分析审核] WHERE [生产单号]=@生产单号", new { 生产单号 });
        if (分析审核 != "1")
            throw new InvalidOperationException($"采购分析单 {生产单号} 未审核，请先在采购物料分析中审核后再下单。");
        var rows = await c.QueryAsync<PurchaseOrderBasisRow>(@"
SELECT b.[ID],b.[物料编号],b.[物料名称],m.[物料类别],b.[规格],b.[颜色],b.[单位],
       b.[总数量],b.[库存数量],b.[可用库存],b.[需订数量],b.[预算单价],b.[供应商编号],b.[供应商名称],
       h.[合同号],
       ISNULL(od.[已订数量],0) AS 已订数量,
       ps.[采购损耗率]
FROM [生产BOM物料清单] b
JOIN [物料资料] m ON m.[物料编号]=b.[物料编号]
JOIN [生产制单] h ON h.[生产单号]=b.[生产单号]
LEFT JOIN [采购物料设置] ps ON ps.[物料编号]=b.[物料编号]
LEFT JOIN (
    SELECT d.[物料编号], ISNULL(d.[颜色],N'') AS 颜色键, SUM(d.[数量]) AS 已订数量
    FROM [采购明细单] d
    JOIN [采购订单] o ON o.[单号]=d.[单号]
    WHERE d.[生产单号]=@生产单号
    GROUP BY d.[物料编号], ISNULL(d.[颜色],N'')
) od ON od.[物料编号]=b.[物料编号] AND od.[颜色键]=ISNULL(b.[颜色],N'')
WHERE b.[生产单号]=@生产单号
  AND (m.[物料类别] IS NULL OR m.[物料类别] NOT LIKE N'%塑胶%')
ORDER BY b.[ID]", new { 生产单号 });
        var list = rows.AsList();
        // 实时可用库存覆盖 BOM 快照；逐物料查一次(行数通常<50,与制单同处理)
        var live = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in list.Select(r => r.物料编号).Where(x => !string.IsNullOrEmpty(x)).Distinct())
            live[code] = await inventory.StockOfAsync(code, null);
        foreach (var r in list)
            if (!string.IsNullOrEmpty(r.物料编号) && live.TryGetValue(r.物料编号, out var qty)) r.可用库存 = qty;
        return list;
    }

    // 订单进度：每行一条采购明细，入仓数量按 订单单号+物料编号+颜色 关联已审核入仓(备品部分不计入,不顶欠数)，欠数=订购−入仓。
    // 备品口径:入仓明细 数量=计入订单欠数的部分(保存时已归一化,备品在 备品数量 列),故直接 SUM(数量) 即可。
    // 注意：入仓按 订单单号+物料编号+颜色 聚合(无明细行ID)。若同一采购订单出现 物料编号+颜色 完全相同的两行，
    //       聚合入仓会同时挂到两行(高估各自入仓/低估欠数)。当前入仓流程未写 订单单号 故暂不触发；待入仓带订单号时需按行ID细化。
    public async Task<IReadOnlyList<PurchaseOrderProgressRow>> ProgressAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed,
        string? 物料类别 = null, string? 日期类型 = null)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);   // 半开区间上界
        var dc = DateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderProgressRow>($@"
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数,
       o.[供应商编号], o.[供应商名称], o.[操作员], o.[审核], d.[备注]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY d.[单号] DESC, d.[ID];",
            new { sup, 起, 止 = 止Excl, kw, cat, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }

    // 进度明细：订单明细 LEFT JOIN 已审核入仓明细(不聚合)，每条入仓一行，零入仓订单行留空。
    // 状态: "已入仓"=入仓单号非空 / "未入仓"=入仓单号空 / 其它=全部。入仓日期取入仓单表头。
    // 备品口径:入仓明细 数量=计入订单欠数的部分(保存时已归一化,备品在 备品数量 列);纯备品行(数量=0)不进进度。
    // 排序 单号→明细ID→入仓日期：同一明细行(ID)要么全是已入仓行、要么唯一一条未入仓空行，
    // 二者不会混在同一 ID 内，故入仓日期的 NULLS FIRST 不会把未入仓行错排到别的明细组中间。
    // 注意：入仓按 订单单号+物料编号+颜色 关联(无明细行ID)。若同一采购订单出现 物料编号+颜色 完全相同的两行，
    //       同一条入仓会同时挂到两行(行数偏多)。当前入仓流程未写 订单单号 故暂不触发；待入仓带订单号时需按行ID细化。
    public async Task<IReadOnlyList<PurchaseOrderProgressDetailRow>> ProgressDetailAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, string? 状态)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);   // 半开区间上界
        var onlyIn = 状态 == "已入仓" ? 1 : 0;
        var onlyOut = 状态 == "未入仓" ? 1 : 0;
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderProgressDetailRow>(@"
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       rk.[入仓单号], rk.[入仓数量], rk.[入仓日期],
       o.[供应商名称], o.[操作员], o.[审核]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           r.[单号] AS 入仓单号, r.[数量] AS 入仓数量, h.[日期] AS 入仓日期, ISNULL(r.[备品],'0') AS [备品]
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1' AND ISNULL(r.[数量],0) <> 0
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyIn = 0 OR rk.[入仓单号] IS NOT NULL)
  AND (@onlyOut = 0 OR rk.[入仓单号] IS NULL)
ORDER BY d.[单号] DESC, d.[ID], rk.[入仓日期];",
            new { sup, 起, 止 = 止Excl, kw, onlyIn, onlyOut });
        return rows.AsList();
    }

    // 日期过滤列白名单：交货日期 / 否则订货日期(日期)。防注入(只允许这两个列名)。
    private static string DateCol(string? 日期类型) => 日期类型 == "交货日期" ? "交货日期" : "日期";

    public async Task<IReadOnlyList<AuxiliaryOrderReceiptStatRow>> AuxiliaryOrderReceiptStatsAsync(
        DateTime 起, DateTime 止, string? keyword, string? 日期类型 = null)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var dc = DateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryOrderReceiptStatRow>($@"
WITH 入库 AS (
    SELECT r.[订单单号],
           r.[物料编号],
           ISNULL(r.[规格],'') AS 规格键,
           ISNULL(r.[颜色],'') AS 颜色键,
           SUM(ISNULL(r.[数量],0)+ISNULL(r.[备品数量],0)) AS 入库数量,
           SUM(ISNULL(r.[金额], ISNULL(r.[数量],0) * ISNULL(r.[单价],0))) AS 入库订货金额HKD
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
      AND r.[仓库] = N'辅料仓库'
      AND r.[物料类别] = N'辅料资料'
    GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[规格],''), ISNULL(r.[颜色],'')
)
SELECT d.[日期] AS 订购日期,
       COALESCE(d.[交货日期], o.[交货日期]) AS 交货日期,
       d.[单号] AS 订购单号,
       COALESCE(NULLIF(d.[供应商名称],N''), o.[供应商名称]) AS 供应商名称,
       d.[物料编号] AS 辅料编号,
       d.[物料名称] AS 辅料名称,
       d.[规格],
       d.[单位],
       d.[单价] AS 采购单价,
       d.[单价] AS 单价HKD,
       CAST(0 AS decimal(18,4)) AS 其他成本单价HKD,
       ISNULL(d.[数量],0) AS 订货数量,
       ISNULL(d.[金额], ISNULL(d.[数量],0) * ISNULL(d.[单价],0)) AS 订货金额HKD,
       ISNULL(r.[入库数量],0) AS 入库数量,
       ISNULL(r.[入库订货金额HKD],0) AS 入库订货金额HKD,
       CAST(0 AS decimal(18,4)) AS 入库其他费用HKD,
       ISNULL(r.[入库订货金额HKD],0) AS 入库金额合计HKD,
       ISNULL(d.[数量],0) - ISNULL(r.[入库数量],0) AS 相关数量,
       ISNULL(d.[金额], ISNULL(d.[数量],0) * ISNULL(d.[单价],0)) - ISNULL(r.[入库订货金额HKD],0) AS 相关金额HKD,
       o.[操作员]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN 入库 r ON r.[订单单号] = d.[单号]
    AND r.[物料编号] = d.[物料编号]
    AND r.[规格键] = ISNULL(d.[规格],'')
    AND r.[颜色键] = ISNULL(d.[颜色],'')
WHERE d.[仓库] = N'辅料仓库'
  AND d.[物料类别] = N'辅料资料'
  AND d.[{dc}] >= @qi
  AND d.[{dc}] < @qe
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR o.[供应商名称] LIKE @kw OR d.[供应商名称] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
ORDER BY d.[日期], d.[单号], d.[ID];",
            new { qi, qe, kw });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryProgressDetailRow>> AuxiliaryProgressDetailAsync(
        string? 到货情况, DateTime? 起, DateTime? 止, string? keyword, string? 日期类型 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var status = string.IsNullOrWhiteSpace(到货情况) ? "未到" : 到货情况.Trim();
        var onlyOwed = status == "未到" ? 1 : 0;
        var onlyComplete = status == "已到" ? 1 : 0;
        var 止Excl = 止?.Date.AddDays(1);
        var dc = DateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryProgressDetailRow>($@"
WITH 入仓明细 AS (
    SELECT r.[订单单号],
           r.[物料编号],
           ISNULL(r.[规格],'') AS 规格键,
           ISNULL(r.[颜色],'') AS 颜色键,
           r.[单号] AS 入仓单号,
           COALESCE(r.[日期], h.[日期]) AS 入仓日期,
           ISNULL(r.[数量],0)+ISNULL(r.[备品数量],0) AS 入仓数量
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
      AND r.[仓库] = N'辅料仓库'
      AND r.[物料类别] = N'辅料资料'
),
入仓汇总 AS (
    SELECT [订单单号], [物料编号], [规格键], [颜色键], SUM([入仓数量]) AS 总入仓数
    FROM 入仓明细
    GROUP BY [订单单号], [物料编号], [规格键], [颜色键]
)
SELECT d.[日期] AS 订购日期,
       COALESCE(d.[交货日期], o.[交货日期]) AS 交货日期,
       d.[单号] AS 订购单号,
       COALESCE(NULLIF(d.[供应商名称],N''), o.[供应商名称]) AS 供应商名称,
       d.[物料编号] AS 辅料编号,
       d.[物料名称] AS 辅料名称,
       d.[规格],
       d.[单位],
       CAST(N'人民币' AS nvarchar(20)) AS 单价类型,
       ISNULL(d.[数量],0) AS 订货数量,
       rm.[入仓日期],
       rm.[入仓单号],
       rm.[入仓数量],
       ISNULL(rt.[总入仓数],0) AS 总入仓数,
       ISNULL(d.[数量],0) - ISNULL(rt.[总入仓数],0) AS 相差数量
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN 入仓汇总 rt ON rt.[订单单号] = d.[单号]
    AND rt.[物料编号] = d.[物料编号]
    AND rt.[规格键] = ISNULL(d.[规格],'')
    AND rt.[颜色键] = ISNULL(d.[颜色],'')
LEFT JOIN 入仓明细 rm ON rm.[订单单号] = d.[单号]
    AND rm.[物料编号] = d.[物料编号]
    AND rm.[规格键] = ISNULL(d.[规格],'')
    AND rm.[颜色键] = ISNULL(d.[颜色],'')
WHERE d.[仓库] = N'辅料仓库'
  AND d.[物料类别] = N'辅料资料'
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR o.[供应商名称] LIKE @kw OR d.[供应商名称] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@onlyOwed = 0 OR (ISNULL(d.[数量],0) - ISNULL(rt.[总入仓数],0)) > 0)
  AND (@onlyComplete = 0 OR (ISNULL(d.[数量],0) - ISNULL(rt.[总入仓数],0)) <= 0)
ORDER BY d.[日期], d.[单号], d.[ID], rm.[入仓日期], rm.[入仓单号];",
            new { 起, 止 = 止Excl, kw, onlyOwed, onlyComplete });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryPurchaseOrderQuerySummaryRow>> AuxiliaryPurchaseOrderQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型, bool 按供应商)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" || 物料类别 == "<所有类别>"
            ? null
            : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        var dc = DateCol(日期类型);
        var supplierSelect = 按供应商
            ? "COALESCE(NULLIF(d.[供应商编号],N''), o.[供应商编号]) AS 供应商编号, COALESCE(NULLIF(d.[供应商名称],N''), o.[供应商名称]) AS 供应商名称,"
            : "CAST(NULL AS nvarchar(40)) AS 供应商编号, CAST(NULL AS nvarchar(120)) AS 供应商名称,";
        var supplierGroup = 按供应商
            ? "COALESCE(NULLIF(d.[供应商编号],N''), o.[供应商编号]), COALESCE(NULLIF(d.[供应商名称],N''), o.[供应商名称]),"
            : "";
        var supplierOrder = 按供应商 ? "供应商编号, " : "";

        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryPurchaseOrderQuerySummaryRow>($@"
SELECT {supplierSelect}
       d.[物料编号] AS 辅料编号,
       MAX(d.[物料名称]) AS 辅料名称,
       d.[规格],
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[数量],0)) AS 订货数量
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE d.[仓库] = N'辅料仓库'
  AND d.[物料类别] = N'辅料资料'
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[单号] LIKE @kw
       OR o.[供应商编号] LIKE @kw OR o.[供应商名称] LIKE @kw
       OR d.[供应商编号] LIKE @kw OR d.[供应商名称] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
GROUP BY {supplierGroup} d.[物料编号], d.[规格]
ORDER BY {supplierOrder} d.[物料编号], d.[规格];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryPurchaseOrderQueryDetailRow>> AuxiliaryPurchaseOrderQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" || 物料类别 == "<所有类别>"
            ? null
            : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        var dc = DateCol(日期类型);
        var onlyApproved = 审核情况 == "已审核" ? 1 : 0;
        var onlyUnapproved = 审核情况 == "未审核" ? 1 : 0;

        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryPurchaseOrderQueryDetailRow>($@"
SELECT COALESCE(d.[日期], o.[日期]) AS 日期,
       d.[单号],
       COALESCE(d.[交货日期], o.[交货日期]) AS 交货日期,
       COALESCE(NULLIF(d.[供应商编号],N''), o.[供应商编号]) AS 供应商编号,
       COALESCE(NULLIF(d.[供应商名称],N''), o.[供应商名称]) AS 供应商名称,
       d.[物料编号] AS 辅料编号,
       d.[物料名称] AS 辅料名称,
       d.[规格],
       d.[单位],
       ISNULL(d.[数量],0) AS 数量,
       d.[备注],
       ISNULL(o.[审核],N'0') AS 审核
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE d.[仓库] = N'辅料仓库'
  AND d.[物料类别] = N'辅料资料'
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
  AND (@onlyApproved = 0 OR ISNULL(o.[审核],N'0') = N'1')
  AND (@onlyUnapproved = 0 OR ISNULL(o.[审核],N'0') <> N'1')
  AND (@kw IS NULL OR d.[单号] LIKE @kw
       OR o.[供应商编号] LIKE @kw OR o.[供应商名称] LIKE @kw
       OR d.[供应商编号] LIKE @kw OR d.[供应商名称] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
ORDER BY COALESCE(d.[日期], o.[日期]) DESC, d.[单号], d.[ID];",
            new { 起, 止 = 止Excl, kw, cat, onlyApproved, onlyUnapproved });
        return rows.AsList();
    }

    // 订购单查询·明细：每行一条采购明细单(只读)。过滤 供应商/日期区间(订货或交货)/物料关键词/物料类别。
    public async Task<IReadOnlyList<PurchaseOrderQueryDetailRow>> OrderQueryDetailAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型 = null)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        var dc = DateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderQueryDetailRow>($@"
SELECT d.[日期], d.[单号], o.[供应商名称], d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量], d.[单价], d.[金额], o.[审核], d.[备注]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
ORDER BY d.[日期] DESC, d.[单号], d.[ID];",
            new { sup, 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    // 订购单查询·汇总：按 物料编号+规格+颜色 合并，SUM(数量)=订购数量。同过滤集。
    public async Task<IReadOnlyList<PurchaseOrderQuerySummaryRow>> OrderQuerySummaryAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型 = null)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        var dc = DateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(d.[物料类别]) AS 物料类别,
       d.[规格], d.[颜色], MAX(d.[单位]) AS 单位, SUM(d.[数量]) AS 订购数量
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[{dc}] >= @起)
  AND (@止 IS NULL OR d.[{dc}] < @止)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
GROUP BY d.[物料编号], d.[规格], d.[颜色]
ORDER BY d.[物料编号], d.[规格], d.[颜色];",
            new { sup, 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    // 合同号(PO号)绑定：未填时按 单头生产单号(或全部明细同属一个生产单) 自动带出 生产制单.合同号；
    // 仍为空则拒单——采购订单必须绑定合同号，下游(入仓/对账)按合同号串联。
    private static string? 绑定生产单号(PurchaseOrderCreateDto dto)
    {
        if (!string.IsNullOrWhiteSpace(dto.生产单号)) return dto.生产单号.Trim();
        var lineMos = dto.明细.Select(l => l.生产单号?.Trim())
            .Where(s => !string.IsNullOrEmpty(s)).Distinct().ToList();
        return lineMos.Count == 1 ? lineMos[0] : null;
    }

    // tx:调用方开了事务必须传入(否则在挂起事务的连接上裸查会被 SQL Server 拒)
    private static async Task<string> BindPO号Async(SqlConnection c, PurchaseOrderCreateDto dto, SqlTransaction? tx = null)
    {
        var po = dto.PO号?.Trim();
        if (!string.IsNullOrEmpty(po)) return po;
        var mo = 绑定生产单号(dto);
        if (mo is not null)
            po = (await c.ExecuteScalarAsync<string?>(
                "SELECT NULLIF(LTRIM(RTRIM(ISNULL([合同号],N''))),N'') FROM [生产制单] WHERE [生产单号]=@mo",
                new { mo }, tx))?.Trim();
        if (string.IsNullOrEmpty(po))
            throw new ArgumentException("采购订单必须绑定合同号（PO号）：请填写 PO号，或指定带合同号的生产单号。");
        return po;
    }

    // 生产通知单下单门(create/update 共用):明细引用的生产通知单(采购分析源单)必须全部已审核,
    // 且采购分析已审核(采购物料分析页独立审核层);手工加行(无生产单号)不查
    private static async Task 校验生产通知单可下单Async(SqlConnection c, PurchaseOrderCreateDto dto)
    {
        var 引用生产单 = dto.明细.Select(l => l.生产单号 ?? dto.生产单号)
            .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()).Distinct().ToList();
        foreach (var mo in 引用生产单)
        {
            var mo审核 = await c.ExecuteScalarAsync<string?>(
                "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@mo", new { mo });
            if (mo审核 is null) throw new ArgumentException($"生产通知单 {mo} 不存在。");
            if (mo审核 != "1") throw new ArgumentException($"生产通知单 {mo} 未审核，审核后才能采购下单。");
            var 分析审核 = await c.ExecuteScalarAsync<string?>(
                "SELECT ISNULL([审核],'0') FROM [采购分析审核] WHERE [生产单号]=@mo", new { mo });
            if (分析审核 != "1")
                throw new ArgumentException($"采购分析单 {mo} 未审核，请先在采购物料分析中审核后再下单。");
        }
    }

    // 单供应商门(create/update 共用):一张采购订单只允许一个供应商的物料——
    // 明细物料在 物料资料 绑定了默认供应商且与本单供应商不一致的,拒绝(改到对应供应商的订单再下)
    private static async Task 校验单供应商Async(SqlConnection c, PurchaseOrderCreateDto dto)
    {
        var codes = dto.明细.Select(l => l.物料编号?.Trim())
            .Where(s => !string.IsNullOrEmpty(s)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (codes.Length == 0) return;
        var bound = (await c.QueryAsync<BoundSupplierRow>(@"
SELECT [物料编号],[供应商编号] FROM [物料资料]
WHERE [物料编号] IN @codes
  AND NULLIF(LTRIM(RTRIM(ISNULL([供应商编号],N''))),N'') IS NOT NULL",
            new { codes })).AsList();
        var bad = bound.FirstOrDefault(b =>
            !string.Equals(b.供应商编号!.Trim(), dto.供应商编号.Trim(), StringComparison.OrdinalIgnoreCase));
        if (bad is not null)
            throw new ArgumentException(
                $"物料 {bad.物料编号} 的默认供应商是 {bad.供应商编号}，与本单供应商 {dto.供应商编号} 不一致；一张采购订单只允许一个供应商的物料。");
    }

    private sealed class BoundSupplierRow
    {
        public string? 物料编号 { get; set; }
        public string? 供应商编号 { get; set; }
    }

    // 保存后回填(create/update 共用,须在事务内):本单物料里还没绑默认供应商的,绑到本单供应商——
    // ① 物料资料主档(日后新单 BOM 展开/采购分析自动归到该供应商组,下次不用重选)
    // ② 明细引用生产单的 BOM 快照行(采购物料分析页按供应商分组的来源)
    // 只填空不覆盖:绑了别家供应商的物料早在 校验单供应商Async 被拦下,到这里的要么未绑、要么绑的就是本单供应商
    private static async Task 回填行供应商Async(SqlConnection c, SqlTransaction tx, PurchaseOrderCreateDto dto)
    {
        var sno = dto.供应商编号.Trim();
        var sname = dto.供应商名称?.Trim();
        if (string.IsNullOrEmpty(sname))
            sname = await c.ExecuteScalarAsync<string?>(
                "SELECT [供应商名称] FROM [供应商资料] WHERE [供应商编号]=@sno", new { sno }, tx);
        var lines = dto.明细.Where(l => !string.IsNullOrWhiteSpace(l.物料编号)).ToList();
        foreach (var code in lines.Select(l => l.物料编号!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase))
            await c.ExecuteAsync(@"
UPDATE [物料资料] SET [供应商编号]=@sno,[供应商名称]=@sname
WHERE [物料编号]=@code AND NULLIF(LTRIM(RTRIM(ISNULL([供应商编号],N''))),N'') IS NULL",
                new { sno, sname, code }, tx);
        foreach (var (mo, code) in lines
            .Select(l => (mo: (l.生产单号 ?? dto.生产单号)?.Trim(), code: l.物料编号!.Trim()))
            .Where(x => !string.IsNullOrEmpty(x.mo))
            .Distinct())
            await c.ExecuteAsync(@"
UPDATE [生产BOM物料清单] SET [供应商编号]=@sno,[供应商名称]=@sname
WHERE [生产单号]=@mo AND [物料编号]=@code AND NULLIF(LTRIM(RTRIM(ISNULL([供应商编号],N''))),N'') IS NULL",
                new { sno, sname, mo, code }, tx);
    }

    public async Task<string> CreateAsync(PurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("采购订单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.供应商编号)) throw new ArgumentException("采购订单必须指定供应商");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        var 日期 = dto.日期 ?? now;   // 单据日期可指定(补录),默认当天

        using var c = factory.Create();
        await c.OpenAsync();
        // 分析门：明细引用的生产通知单(采购分析源单)必须全部已审核；手工加行(无生产单号)不查
        await 校验生产通知单可下单Async(c, dto);
        await 校验单供应商Async(c, dto);
        var PO号 = await BindPO号Async(c, dto);
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[生产单号],[PO号],[收件人],[打印次数])
VALUES(@单号,@日期,@交货日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@生产单号,@PO号,@收件人,0)",
            new { 单号, 日期, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注, dto.生产单号, PO号, dto.收件人 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购明细单]([单号],[生产单号],[款号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[材料],[单位],[数量],[单价],[金额],[预算数量],[备注])
VALUES(@单号,@生产单号,@款号,@日期,@交货日期,@供应商编号,@供应商名称,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@材料,@单位,@数量,@单价,@金额,@预算数量,@备注)",
                new { 单号, 生产单号 = l.生产单号 ?? dto.生产单号, 款号 = l.款号 ?? dto.款号, 日期, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.仓库,
                      l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.材料, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.预算数量, l.备注 }, tx);

        await 回填行供应商Async(c, tx, dto);
        tx.Commit();
        return 单号;
    }

    // 更新:仅未审核可改;单事务 更新单头 + 删旧明细插新明细;数量/金额按明细重算(不信任前端)
    public async Task<bool> UpdateAsync(string 单号, PurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("采购订单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.供应商编号)) throw new ArgumentException("采购订单必须指定供应商");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));

        using var c = factory.Create();
        await c.OpenAsync();
        // 同 create:明细引用的生产通知单必须已审核(防止改单改挂到未审核/不存在的生产通知单)
        await 校验生产通知单可下单Async(c, dto);
        await 校验单供应商Async(c, dto);
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购订单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的采购订单不能修改，请先反审核。");
        var PO号 = await BindPO号Async(c, dto, tx);

        await c.ExecuteAsync(@"
UPDATE [采购订单] SET [交货日期]=@交货日期,[供应商编号]=@供应商编号,[供应商名称]=@供应商名称,
    [仓库]=@仓库,[数量]=@数量,[金额]=@金额,[备注]=@备注,[生产单号]=@生产单号,[PO号]=@PO号,[收件人]=@收件人,
    [日期]=COALESCE(@日期,[日期])
WHERE [单号]=@单号",
            new { 单号, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, dto.备注, dto.生产单号, PO号, dto.收件人, dto.日期 }, tx);

        await c.ExecuteAsync("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        var 日期 = dto.日期 ?? await c.ExecuteScalarAsync<DateTime?>(
            "SELECT [日期] FROM [采购订单] WHERE [单号]=@单号", new { 单号 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购明细单]([单号],[生产单号],[款号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[材料],[单位],[数量],[单价],[金额],[预算数量],[备注])
VALUES(@单号,@生产单号,@款号,@日期,@交货日期,@供应商编号,@供应商名称,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@材料,@单位,@数量,@单价,@金额,@预算数量,@备注)",
                new { 单号, 生产单号 = l.生产单号 ?? dto.生产单号, 款号 = l.款号 ?? dto.款号, 日期, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.仓库,
                      l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.材料, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.预算数量, l.备注 }, tx);

        await 回填行供应商Async(c, tx, dto);
        tx.Commit();
        return true;
    }

    // 打印:打印次数+1,返回新计数(单不存在返回 null)
    public async Task<int?> PrintAsync(string 单号)
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<int?>(@"
UPDATE [采购订单] SET [打印次数]=ISNULL([打印次数],0)+1 WHERE [单号]=@单号;
SELECT [打印次数] FROM [采购订单] WHERE [单号]=@单号;", new { 单号 });
    }

    public async Task<PagedResult<PurchaseOrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [采购订单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [生产单号] LIKE @kw;
SELECT [ID],[单号],[日期],[交货日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[生产单号],[PO号],[收件人],[打印次数],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [采购订单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [生产单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PurchaseOrderHeaderDto>()).AsList();
        return new PagedResult<PurchaseOrderHeaderDto>(items, total);
    }

    public async Task<PurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT o.[ID],o.[单号],o.[日期],o.[交货日期],o.[供应商编号],o.[供应商名称],o.[仓库],o.[数量],o.[金额],o.[操作员],o.[审核],o.[审核人],o.[备注],o.[生产单号],o.[PO号],o.[收件人],o.[打印次数],o.[主管审核],o.[主管审核人],o.[经理审核],o.[经理审核人],
       s.[联系人] AS [供应商联系人],s.[电话] AS [供应商电话],s.[传真] AS [供应商传真],s.[货币] AS [供应商货币],s.[付款方式] AS [供应商付款方式]
FROM [采购订单] o
LEFT JOIN [供应商资料] s ON s.[供应商编号]=o.[供应商编号]
WHERE o.[单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[材料],[单位],[数量],[单价],[金额],[预算数量],[生产单号],[款号],[备注],[供应商编号],[供应商名称]
FROM [采购明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PurchaseOrderHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PurchaseOrderLineRowDto>()).AsList();
        // 可用库存返回实时库存(与 basis/采购分析同口径),重开已存单也能看到当前库存
        var live = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in lines.Select(l => l.物料编号).Where(x => !string.IsNullOrEmpty(x)).Distinct())
            live[code!] = await inventory.StockOfAsync(code!, null);
        foreach (var l in lines)
            if (!string.IsNullOrEmpty(l.物料编号) && live.TryGetValue(l.物料编号, out var qty)) l.可用库存 = qty;
        return new PurchaseOrderDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；FK 顺序 明细→单头
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购订单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的采购订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [采购明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [采购订单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
