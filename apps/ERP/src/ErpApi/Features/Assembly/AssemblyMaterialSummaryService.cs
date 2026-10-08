using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Assembly;

public sealed class AssemblyMaterialSummaryService(ISqlConnectionFactory factory)
{
    private static string? Like(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : $"%{value.Trim()}%";

    private static string? Exact(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : value.Trim();

    public async Task<AssemblyMaterialSummaryResult> ListAsync(
        DateTime? 起,
        DateTime? 止,
        bool 启用日期,
        string? 客户,
        string? 装配方式,
        string? 完成情况,
        string? keyword)
    {
        using var c = factory.Create();
        var p = new
        {
            start = 启用日期 ? 起 : null,
            end = 启用日期 ? 止 : null,
            customer = Like(客户),
            method = Like(装配方式),
            completion = Exact(完成情况),
            kw = Like(keyword),
        };

        var summary = await c.QueryAsync<AssemblyMaterialSummaryRow>(@"
WITH d AS (
    SELECT
        [款号],
        MAX([款式]) AS 款式,
        MAX([客户编号]) AS 客户编号,
        MAX([客户名称]) AS 客户名称,
        MAX([日期]) AS 日期,
        MAX([单位]) AS 单位,
        MAX([备注]) AS 备注,
        SUM(ISNULL([使用数量],0)) AS 明细用量
    FROM [款号物料明细表]
    GROUP BY [款号]
)
SELECT
    COALESCE(h.[客户名称], d.[客户名称], h.[客户], d.[客户编号]) AS 客户,
    d.[款号] AS 产品货号,
    COALESCE(h.[款式], d.[款式]) AS 产品名称,
    h.[产品编号] AS 配件编号,
    COALESCE(h.[款式], d.[款式]) AS 产品装配名称,
    COALESCE(h.[日期], d.[日期]) AS 日期,
    CAST(NULL AS nvarchar(80)) AS 加工厂名称,
    h.[制作要求] AS 装配方式,
    CAST(0 AS decimal(18,4)) AS 对比相差,
    N'0%' AS 相关比例,
    CAST(NULL AS nvarchar(80)) AS 仓库位置,
    COALESCE(h.[使用数量], d.[明细用量]) AS 需求用量,
    h.[操作员] AS 操作员,
    COALESCE(h.[备注], d.[备注]) AS 备注
FROM d
OUTER APPLY (
    SELECT TOP 1 *
    FROM [款号物料总表] h
    WHERE h.[款号] = d.[款号]
    ORDER BY h.[ID] DESC
) h
WHERE (@start IS NULL OR COALESCE(h.[日期], d.[日期]) >= @start)
  AND (@end IS NULL OR COALESCE(h.[日期], d.[日期]) < DATEADD(day, 1, @end))
  AND (@customer IS NULL OR h.[客户编号] LIKE @customer OR h.[客户名称] LIKE @customer OR h.[客户] LIKE @customer OR d.[客户编号] LIKE @customer OR d.[客户名称] LIKE @customer)
  AND (@method IS NULL OR h.[制作要求] LIKE @method)
  AND (
        @completion IS NULL
        OR @completion = N'全部'
        OR (@completion IN (N'已审核', N'已完成') AND ISNULL(h.[审核], '0') = '1')
        OR (@completion IN (N'未审核', N'未完成') AND ISNULL(h.[审核], '0') <> '1')
      )
  AND (@kw IS NULL OR d.[款号] LIKE @kw OR d.[款式] LIKE @kw OR h.[产品编号] LIKE @kw)
ORDER BY COALESCE(h.[日期], d.[日期]) DESC, d.[款号];", p);

        var detail = await c.QueryAsync<AssemblyMaterialDetailRow>(@"
SELECT
    COALESCE(h.[客户名称], d.[客户名称], h.[客户], d.[客户编号]) AS 客户,
    d.[款号] AS 产品货号,
    COALESCE(h.[款式], d.[款式]) AS 产品名称,
    h.[产品编号] AS 配件编号,
    COALESCE(h.[款式], d.[款式]) AS 产品装配名称,
    COALESCE(h.[日期], d.[日期]) AS 日期,
    h.[制作要求] AS 装配方式,
    d.[物料编号] AS 物料编号,
    d.[物料名称] AS 物料名称,
    d.[规格] AS 规格,
    d.[物料类别] AS 材料,
    d.[颜色] AS 颜色,
    d.[单位] AS 单位,
    d.[使用数量] AS 用量,
    d.[备注] AS 备注,
    h.[操作员] AS 操作员
FROM [款号物料明细表] d
OUTER APPLY (
    SELECT TOP 1 *
    FROM [款号物料总表] h
    WHERE h.[款号] = d.[款号]
    ORDER BY h.[ID] DESC
) h
WHERE (@start IS NULL OR COALESCE(h.[日期], d.[日期]) >= @start)
  AND (@end IS NULL OR COALESCE(h.[日期], d.[日期]) < DATEADD(day, 1, @end))
  AND (@customer IS NULL OR h.[客户编号] LIKE @customer OR h.[客户名称] LIKE @customer OR h.[客户] LIKE @customer OR d.[客户编号] LIKE @customer OR d.[客户名称] LIKE @customer)
  AND (@method IS NULL OR h.[制作要求] LIKE @method)
  AND (
        @completion IS NULL
        OR @completion = N'全部'
        OR (@completion IN (N'已审核', N'已完成') AND ISNULL(h.[审核], '0') = '1')
        OR (@completion IN (N'未审核', N'未完成') AND ISNULL(h.[审核], '0') <> '1')
      )
  AND (@kw IS NULL OR d.[款号] LIKE @kw OR d.[款式] LIKE @kw OR h.[产品编号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
ORDER BY COALESCE(h.[日期], d.[日期]) DESC, d.[款号], d.[顺序], d.[ID];", p);

        return new AssemblyMaterialSummaryResult
        {
            汇总 = summary.AsList(),
            明细 = detail.AsList(),
        };
    }
}
