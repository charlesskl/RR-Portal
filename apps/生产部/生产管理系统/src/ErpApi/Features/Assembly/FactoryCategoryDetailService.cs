using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Assembly;

public sealed class FactoryCategoryDetailRow
{
    public string? 加工厂类别 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 单据类型 { get; set; }   // 塑胶加工采购单 / 装配加工采购单
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

// 加工厂分类明细表(发外加工/外发装配):按 加工厂类别→加工厂 列加工采购业务明细。
// 数据源:塑胶加工采购单(直接带 加工厂编号) + 装配加工采购单(供应商编号即加工厂,同 AssemblyPurchaseProgressPage 口径);
// 类别取自 加工厂资料.加工厂类别,无主档归「未分类」。
public sealed class FactoryCategoryDetailService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<FactoryCategoryDetailRow>> ListAsync(
        DateTime? 起, DateTime? 止, string? 类别, string? 加工厂, string? keyword)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var cat = string.IsNullOrWhiteSpace(类别) || 类别 == "全部" ? null : 类别.Trim();
        var fac = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<FactoryCategoryDetailRow>(@"
WITH src AS (
    SELECT o.[加工厂编号], o.[加工厂名称], N'塑胶加工采购单' AS 单据类型,
           o.[单号], o.[日期], o.[交货日期], o.[客户名称],
           ISNULL(o.[数量],0) AS 数量, ISNULL(o.[金额],0) AS 金额, o.[审核]
    FROM [塑胶加工采购单] o
    UNION ALL
    SELECT a.[供应商编号], a.[供应商名称], N'委托加工单',
           a.[单号], a.[日期], a.[开始交货日期], a.[客户名称],
           ISNULL(a.[数量],0), ISNULL(a.[金额],0), a.[审核]
    FROM [装配加工采购单] a
)
SELECT COALESCE(NULLIF(f.[加工厂类别],N''), N'未分类') AS 加工厂类别,
       s.[加工厂编号],
       s.[加工厂名称],
       s.[单据类型],
       s.[单号],
       s.[日期],
       s.[交货日期],
       s.[客户名称],
       s.[数量],
       s.[金额],
       s.[审核]
FROM src s
LEFT JOIN [加工厂资料] f ON f.[加工厂编号] = s.[加工厂编号]
WHERE (@qi IS NULL OR s.[日期] >= @qi)
  AND (@qe IS NULL OR s.[日期] < @qe)
  AND (@cat IS NULL OR COALESCE(NULLIF(f.[加工厂类别],N''), N'未分类') = @cat)
  AND (@fac IS NULL OR s.[加工厂编号] LIKE @fac OR s.[加工厂名称] LIKE @fac)
  AND (@kw IS NULL OR s.[单号] LIKE @kw OR s.[客户名称] LIKE @kw OR s.[加工厂编号] LIKE @kw OR s.[加工厂名称] LIKE @kw)
ORDER BY COALESCE(NULLIF(f.[加工厂类别],N''), N'未分类'), s.[加工厂编号], s.[日期], s.[单号];",
            new { qi, qe, cat, fac, kw });
        return rows.AsList();
    }
}
