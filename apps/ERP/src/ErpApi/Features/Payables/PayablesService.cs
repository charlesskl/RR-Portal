using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payables;

// 应付对账(算法5 AP)：供应商=采购入仓−采购付款；加工厂=发外回收−发外付款。各 JOIN/过滤 审核='1'。只读。
public sealed class PayablesService(ISqlConnectionFactory factory)
{
    private const string SupplierSql = @"
SELECT 供应商编号, MAX(供应商名称) AS 供应商名称,
       SUM(CASE WHEN 类型='入仓' THEN 金额 ELSE 0 END) AS 入仓金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='入仓' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 供应商编号, 供应商名称, '入仓' AS 类型, ISNULL(金额,0) AS 金额
      FROM [采购入仓单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.供应商编号, d.供应商名称, '付款', ISNULL(d.付款金额,0)
      FROM [采购付款明细单] d JOIN [采购付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @供应商编号 IS NULL OR 供应商编号=@供应商编号
GROUP BY 供应商编号 ORDER BY 供应商编号;";

    private const string FactorySql = @"
SELECT 加工厂编号, MAX(加工厂名称) AS 加工厂名称,
       SUM(CASE WHEN 类型='回收' THEN 金额 ELSE 0 END) AS 回收金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='回收' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 加工厂编号, 加工厂名称, '回收' AS 类型, ISNULL(金额,0) AS 金额
      FROM [发外回收明细单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.加工厂编号, d.加工厂名称, '付款', ISNULL(d.付款金额,0)
      FROM [发外加工付款明细单] d JOIN [发外加工付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @加工厂编号 IS NULL OR 加工厂编号=@加工厂编号
GROUP BY 加工厂编号 ORDER BY 加工厂编号;";

    public async Task<IReadOnlyList<PayableSupplierRow>> SupplierAsync(string? 供应商编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PayableSupplierRow>(SupplierSql, new { 供应商编号 = string.IsNullOrWhiteSpace(供应商编号) ? null : 供应商编号.Trim() });
        return rows.AsList();
    }
    public async Task<IReadOnlyList<PayableFactoryRow>> FactoryAsync(string? 加工厂编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PayableFactoryRow>(FactorySql, new { 加工厂编号 = string.IsNullOrWhiteSpace(加工厂编号) ? null : 加工厂编号.Trim() });
        return rows.AsList();
    }

    // ---- per-doc 派生(供应商轨):每张采购入仓单 应付/已付/未付(入仓单审核'1';付款按付款单头审核'1' Σ by 入仓单号) ----
    private const string PerPurchase = @"
SELECT s.[单号] AS 入仓单号, s.[日期] AS 入仓日期, s.[供应商编号], s.[供应商名称],
       ISNULL(s.[金额],0) AS 应付金额, ISNULL(p.已付,0) AS 已付金额, ISNULL(s.[金额],0)-ISNULL(p.已付,0) AS 未付余额
FROM [采购入仓单] s
LEFT JOIN (SELECT d.[入仓单号],SUM(ISNULL(d.[付款金额],0)) 已付 FROM [采购付款明细单] d JOIN [采购付款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[入仓单号]) p ON p.[入仓单号]=s.[单号]
WHERE ISNULL(s.[审核],'0')='1'";

    // ---- per-doc 派生(加工厂轨):按发外单号归集 应付(Σ发外回收明细金额,明细审核'1')/已付(Σ发外付款,付款单头审核'1' by 发外单号)/未付 ----
    private const string PerOutsource = @"
SELECT f.发外单号, f.回收日期, f.加工厂编号, f.加工厂名称,
       ISNULL(f.应付,0) AS 应付金额, ISNULL(p.已付,0) AS 已付金额, ISNULL(f.应付,0)-ISNULL(p.已付,0) AS 未付余额
FROM (SELECT d.[发外单号], MIN(d.[日期]) AS 回收日期, MAX(d.[加工厂编号]) AS 加工厂编号, MAX(d.[加工厂名称]) AS 加工厂名称, SUM(ISNULL(d.[金额],0)) AS 应付
      FROM [发外回收明细单] d WHERE ISNULL(d.[审核],'0')='1' GROUP BY d.[发外单号]) f
LEFT JOIN (SELECT d.[发外单号],SUM(ISNULL(d.[付款金额],0)) 已付 FROM [发外加工付款明细单] d JOIN [发外加工付款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[发外单号]) p ON p.[发外单号]=f.发外单号";

    // ===== 供应商轨:逐单核销 / 账龄 / 待付 =====
    public async Task<IReadOnlyList<PayableSupplierSettlementRow>> SupplierSettlementAsync(string? 供应商编号, bool 仅未结清)
    {
        var 编 = string.IsNullOrWhiteSpace(供应商编号) ? null : 供应商编号.Trim();
        var sql = $"SELECT * FROM ({PerPurchase} AND (@编 IS NULL OR s.[供应商编号]=@编)) t "
                + (仅未结清 ? "WHERE t.未付余额 > 0.005 " : "")
                + "ORDER BY t.供应商编号, t.入仓日期, t.入仓单号";
        using var c = factory.Create();
        return (await c.QueryAsync<PayableSupplierSettlementRow>(sql, new { 编 })).AsList();
    }

    public async Task<IReadOnlyList<PayableSupplierAgingRow>> SupplierAgingAsync(string? 供应商编号, DateTime? 基准日)
    {
        var 编 = string.IsNullOrWhiteSpace(供应商编号) ? null : 供应商编号.Trim();
        var 基准 = 基准日 ?? DateTime.Today;
        var sql = $@"
SELECT t.供应商编号, MAX(t.供应商名称) AS 供应商名称,
  SUM(CASE WHEN d<=30 THEN 余 ELSE 0 END) AS 账龄0_30,
  SUM(CASE WHEN d BETWEEN 31 AND 60 THEN 余 ELSE 0 END) AS 账龄31_60,
  SUM(CASE WHEN d BETWEEN 61 AND 90 THEN 余 ELSE 0 END) AS 账龄61_90,
  SUM(CASE WHEN d>90 THEN 余 ELSE 0 END) AS 账龄90以上,
  SUM(余) AS 合计
FROM (SELECT t.供应商编号, t.供应商名称, DATEDIFF(day, t.入仓日期, @基准) AS d, t.未付余额 AS 余
      FROM ({PerPurchase} AND (@编 IS NULL OR s.[供应商编号]=@编)) t WHERE t.未付余额 > 0.005) t
GROUP BY t.供应商编号 ORDER BY t.供应商编号";
        using var c = factory.Create();
        return (await c.QueryAsync<PayableSupplierAgingRow>(sql, new { 编, 基准 })).AsList();
    }

    public async Task<IReadOnlyList<UnpaidPurchaseRow>> SupplierUnpaidAsync(string 供应商编号)
    {
        var sql = $"SELECT t.入仓单号,t.入仓日期,t.应付金额,t.已付金额,t.未付余额 FROM ({PerPurchase} AND s.[供应商编号]=@编) t WHERE t.未付余额 > 0.005 ORDER BY t.入仓日期, t.入仓单号";
        using var c = factory.Create();
        return (await c.QueryAsync<UnpaidPurchaseRow>(sql, new { 编 = 供应商编号 })).AsList();
    }

    // ===== 加工厂轨:逐单核销 / 账龄 / 待付（外层别名 t.加工厂编号/t.回收日期/t.未付余额）=====
    public async Task<IReadOnlyList<PayableFactorySettlementRow>> FactorySettlementAsync(string? 加工厂编号, bool 仅未结清)
    {
        var 编 = string.IsNullOrWhiteSpace(加工厂编号) ? null : 加工厂编号.Trim();
        var sql = $"SELECT * FROM ({PerOutsource}) t WHERE (@编 IS NULL OR t.加工厂编号=@编) "
                + (仅未结清 ? "AND t.未付余额 > 0.005 " : "")
                + "ORDER BY t.加工厂编号, t.回收日期, t.发外单号";
        using var c = factory.Create();
        return (await c.QueryAsync<PayableFactorySettlementRow>(sql, new { 编 })).AsList();
    }

    public async Task<IReadOnlyList<PayableFactoryAgingRow>> FactoryAgingAsync(string? 加工厂编号, DateTime? 基准日)
    {
        var 编 = string.IsNullOrWhiteSpace(加工厂编号) ? null : 加工厂编号.Trim();
        var 基准 = 基准日 ?? DateTime.Today;
        var sql = $@"
SELECT t.加工厂编号, MAX(t.加工厂名称) AS 加工厂名称,
  SUM(CASE WHEN d<=30 THEN 余 ELSE 0 END) AS 账龄0_30,
  SUM(CASE WHEN d BETWEEN 31 AND 60 THEN 余 ELSE 0 END) AS 账龄31_60,
  SUM(CASE WHEN d BETWEEN 61 AND 90 THEN 余 ELSE 0 END) AS 账龄61_90,
  SUM(CASE WHEN d>90 THEN 余 ELSE 0 END) AS 账龄90以上,
  SUM(余) AS 合计
FROM (SELECT t.加工厂编号, t.加工厂名称, DATEDIFF(day, t.回收日期, @基准) AS d, t.未付余额 AS 余
      FROM ({PerOutsource}) t WHERE (@编 IS NULL OR t.加工厂编号=@编) AND t.未付余额 > 0.005) t
GROUP BY t.加工厂编号 ORDER BY t.加工厂编号";
        using var c = factory.Create();
        return (await c.QueryAsync<PayableFactoryAgingRow>(sql, new { 编, 基准 })).AsList();
    }

    public async Task<IReadOnlyList<UnpaidOutsourceRow>> FactoryUnpaidAsync(string 加工厂编号)
    {
        var sql = $"SELECT t.发外单号,t.回收日期,t.应付金额,t.已付金额,t.未付余额 FROM ({PerOutsource}) t WHERE t.加工厂编号=@编 AND t.未付余额 > 0.005 ORDER BY t.回收日期, t.发外单号";
        using var c = factory.Create();
        return (await c.QueryAsync<UnpaidOutsourceRow>(sql, new { 编 = 加工厂编号 })).AsList();
    }
}
