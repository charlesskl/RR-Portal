using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

// 原料采购订单(原料仓库·采购计划)。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存)。
public sealed class PlasticRawMaterialPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料采购订单";
    public const string Prefix = "YCD";   // 原料采购订单号 = YCD + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialPurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料采购订单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.订货数量);
        var 金额合计 = dto.明细.Sum(l => l.订货数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料采购订单]([单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@供应商编号,@供应商名称,@订购日期,@交货日期,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.供应商编号, dto.供应商名称, 订购日期 = now, dto.交货日期,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料采购订单明细]([单号],[原料编号],[原料名称],[规格],[单位],[单价类型],[订货数量],[单价],[金额],[备注])
VALUES(@单号,@原料编号,@原料名称,@规格,@单位,@单价类型,@订货数量,@单价,@金额,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.规格, l.单位, l.单价类型, l.订货数量, l.单价,
                      金额 = l.订货数量 * (l.单价 ?? 0m), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialPurchaseOrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [原料采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialPurchaseOrderHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialPurchaseOrderHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [原料采购订单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[规格],[单位],[单价类型],[订货数量],[单价],[金额],[备注]
FROM [原料采购订单明细] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialPurchaseOrderHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialPurchaseOrderLineDto>()).AsList();
        return new PlasticRawMaterialPurchaseOrderDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料采购订单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料采购订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料采购订单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料采购订单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    public async Task<IReadOnlyList<PlasticRawMaterialOrderReceiptStatRow>> OrderReceiptStatsAsync(
        DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialOrderReceiptStatRow>(@"
WITH 入库 AS (
    SELECT h.[订单单号],
           d.[原料编号],
           SUM(ISNULL(d.[数量],0)) AS 入库数量包,
           SUM(ISNULL(d.[金额], ISNULL(d.[数量],0) * ISNULL(d.[单价],0))) AS 入库订货金额HKD
    FROM [原料入仓明细单] d
    JOIN [原料入仓单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1' AND ISNULL(d.[备品],'0') <> '1'
    GROUP BY h.[订单单号], d.[原料编号]
)
SELECT o.[订购日期],
       o.[交货日期],
       o.[单号] AS 订购单号,
       o.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       d.[单位],
       d.[单价] AS 采购单价,
       d.[单价] AS 单价HKDLb,
       CAST(0 AS decimal(18,4)) AS 其他成本单价HKDLb,
       ISNULL(d.[订货数量],0) AS 订货数量包,
       ISNULL(d.[金额], ISNULL(d.[订货数量],0) * ISNULL(d.[单价],0)) AS 订货金额HKD,
       ISNULL(r.[入库数量包],0) AS 入库数量包,
       ISNULL(r.[入库订货金额HKD],0) AS 入库订货金额HKD,
       CAST(0 AS decimal(18,4)) AS 入库其他费用HKD,
       ISNULL(r.[入库订货金额HKD],0) AS 入库金额合计HKD,
       ISNULL(d.[订货数量],0) - ISNULL(r.[入库数量包],0) AS 相关数量包,
       ISNULL(d.[金额], ISNULL(d.[订货数量],0) * ISNULL(d.[单价],0)) - ISNULL(r.[入库订货金额HKD],0) AS 相关金额HKD
FROM [原料采购订单明细] d
JOIN [原料采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN 入库 r ON r.[订单单号] = o.[单号] AND r.[原料编号] = d.[原料编号]
WHERE o.[订购日期] >= @qi AND o.[订购日期] < @qe
  AND (@kw IS NULL OR o.[单号] LIKE @kw OR o.[供应商名称] LIKE @kw OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
ORDER BY o.[订购日期], o.[单号], d.[ID];", new { qi, qe, kw });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialProgressDetailRow>> ProgressDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 到货情况, string? 日期类型)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var onlyReceived = 到货情况 == "已到" ? 1 : 0;
        var onlyNotReceived = 到货情况 == "未到" ? 1 : 0;
        var dateCol = 日期类型 switch
        {
            "订购日期" => "o.[订购日期]",
            "交货日期" => "o.[交货日期]",
            "入仓日期" => "rk.[入仓日期]",
            _ => null
        };
        var dateWhere = dateCol is null ? "" : $"  AND (@qi IS NULL OR {dateCol} >= @qi)\n  AND (@qe IS NULL OR {dateCol} < @qe)\n";

        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialProgressDetailRow>($@"
WITH 入仓 AS (
    SELECT h.[订单单号],
           d.[原料编号],
           d.[原料名称],
           d.[产地],
           d.[每包重量],
           d.[单位],
           d.[单价类型],
           h.[日期] AS 入仓日期,
           d.[单号] AS 入仓单号,
           ISNULL(d.[数量],0) AS 入仓数量,
           ISNULL(d.[备品],'0') AS 备品,
           SUM(CASE WHEN ISNULL(d.[备品],'0')<>'1' THEN ISNULL(d.[数量],0) ELSE 0 END) OVER (PARTITION BY h.[订单单号], d.[原料编号]) AS 总入仓数
    FROM [原料入仓明细单] d
    JOIN [原料入仓单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
)
SELECT o.[订购日期],
       o.[交货日期],
       o.[单号] AS 订购单号,
       o.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       rk.[产地],
       rk.[每包重量],
       COALESCE(rk.[单位], d.[单位]) AS 单位,
       COALESCE(rk.[单价类型], d.[单价类型]) AS 单价类型,
       ISNULL(d.[订货数量],0) AS 订货数量,
       rk.[入仓日期],
       rk.[入仓单号],
       rk.[入仓数量],
       rk.[备品],
       ISNULL(rk.[总入仓数],0) AS 总入仓数,
       ISNULL(d.[订货数量],0) - ISNULL(rk.[总入仓数],0) AS 相差数量,
       o.[操作员],
       o.[审核]
FROM [原料采购订单明细] d
JOIN [原料采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN 入仓 rk ON rk.[订单单号] = o.[单号] AND rk.[原料编号] = d.[原料编号]
WHERE (@kw IS NULL OR o.[单号] LIKE @kw OR o.[供应商名称] LIKE @kw OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
{dateWhere}  AND (@onlyReceived = 0 OR rk.[入仓单号] IS NOT NULL)
  AND (@onlyNotReceived = 0 OR rk.[入仓单号] IS NULL)
ORDER BY o.[订购日期] DESC, o.[单号], d.[ID], rk.[入仓日期], rk.[入仓单号];",
            new { qi, qe, kw, onlyReceived, onlyNotReceived });
        return rows.AsList();
    }

    // 原料采购进度表:每行一条采购订单明细,入仓按 订单单号+原料编号 关联已审核原料入仓(备品行不计入,同 OrderReceiptStatsAsync 口径),
    // 欠数=订货−入仓,进度=入仓/订货×100(%)。日期过滤列白名单:交货日期 / 否则订购日期(防注入)。
    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseProgressRow>> ProgressAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed, string? 日期类型)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);   // 半开区间上界
        var dateCol = 日期类型 == "交货日期" ? "交货日期" : "订购日期";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialPurchaseProgressRow>($@"
WITH 入仓 AS (
    SELECT h.[订单单号],
           d.[原料编号],
           SUM(ISNULL(d.[数量],0)) AS 入仓数量
    FROM [原料入仓明细单] d
    JOIN [原料入仓单] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1' AND ISNULL(d.[备品],'0') <> '1'
    GROUP BY h.[订单单号], d.[原料编号]
)
SELECT o.[订购日期],
       o.[交货日期],
       o.[单号] AS 采购单号,
       o.[供应商编号],
       o.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       d.[规格],
       d.[单位],
       d.[单价类型],
       ISNULL(d.[订货数量],0) AS 订货数量,
       ISNULL(r.[入仓数量],0) AS 入仓数量,
       ISNULL(d.[订货数量],0) - ISNULL(r.[入仓数量],0) AS 欠数,
       CASE WHEN ISNULL(d.[订货数量],0) = 0 THEN NULL
            ELSE CAST(ISNULL(r.[入仓数量],0) * 100.0 / d.[订货数量] AS decimal(18,2)) END AS 进度,
       o.[操作员],
       o.[审核],
       d.[备注]
FROM [原料采购订单明细] d
JOIN [原料采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN 入仓 r ON r.[订单单号] = o.[单号] AND r.[原料编号] = d.[原料编号]
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@qi IS NULL OR o.[{dateCol}] >= @qi)
  AND (@qe IS NULL OR o.[{dateCol}] < @qe)
  AND (@kw IS NULL OR o.[单号] LIKE @kw OR o.[供应商编号] LIKE @kw OR o.[供应商名称] LIKE @kw
       OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (ISNULL(d.[订货数量],0) - ISNULL(r.[入仓数量],0)) > 0)
ORDER BY o.[订购日期] DESC, o.[单号], d.[ID];",
            new { sup, qi, qe, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }

    private static string OrderQueryDateCol(string? 日期类型) => 日期类型 == "交货日期" ? "交货日期" : "订购日期";

    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseOrderQueryDetailRow>> OrderQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        var dateCol = OrderQueryDateCol(日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialPurchaseOrderQueryDetailRow>($@"
SELECT o.[订购日期],
       o.[交货日期],
       o.[单号],
       o.[供应商编号],
       o.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       m.[产地],
       d.[单位],
       d.[单价类型],
       d.[订货数量],
       d.[单价],
       d.[金额],
       o.[审核],
       d.[备注]
FROM [原料采购订单明细] d
JOIN [原料采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE (@qi IS NULL OR o.[{dateCol}] >= @qi)
  AND (@qe IS NULL OR o.[{dateCol}] < @qe)
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw
       OR o.[单号] LIKE @kw OR o.[供应商编号] LIKE @kw OR o.[供应商名称] LIKE @kw)
ORDER BY o.[订购日期] DESC, o.[单号], d.[ID];", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseOrderQuerySummaryRow>> OrderQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 日期类型, bool 按供应商)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        var dateCol = OrderQueryDateCol(日期类型);
        var supplierSelect = 按供应商 ? "o.[供应商编号], o.[供应商名称]," : "CAST(NULL AS nvarchar(40)) AS 供应商编号, CAST(NULL AS nvarchar(80)) AS 供应商名称,";
        var supplierGroup = 按供应商 ? "o.[供应商编号], o.[供应商名称]," : "";
        var supplierOrder = 按供应商 ? "供应商编号, " : "";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialPurchaseOrderQuerySummaryRow>($@"
SELECT {supplierSelect}
       d.[原料编号],
       MAX(d.[原料名称]) AS 原料名称,
       MAX(m.[产地]) AS 产地,
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[订货数量],0)) AS 订货数量
FROM [原料采购订单明细] d
JOIN [原料采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE (@qi IS NULL OR o.[{dateCol}] >= @qi)
  AND (@qe IS NULL OR o.[{dateCol}] < @qe)
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw
       OR o.[单号] LIKE @kw OR o.[供应商编号] LIKE @kw OR o.[供应商名称] LIKE @kw)
GROUP BY {supplierGroup} d.[原料编号]
ORDER BY {supplierOrder} d.[原料编号];", new { qi, qe, kw, cat });
        return rows.AsList();
    }
}
