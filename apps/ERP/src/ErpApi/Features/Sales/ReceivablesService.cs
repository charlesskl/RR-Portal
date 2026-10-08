using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 应收对账（算法5）：应收余额 = 出货 − 收款 − 退货，按客户。JOIN 各单头按 审核='1' 过滤。只读。
public sealed class ReceivablesService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT 客户编号, MAX(客户名称) AS 客户名称,
       SUM(CASE WHEN 类型='出货' THEN 金额 ELSE 0 END) AS 出货金额,
       SUM(CASE WHEN 类型='收款' THEN 金额 ELSE 0 END) AS 收款金额,
       SUM(CASE WHEN 类型='退货' THEN 金额 ELSE 0 END) AS 退货金额,
       SUM(CASE WHEN 类型='出货' THEN 金额 WHEN 类型='收款' THEN -金额 WHEN 类型='退货' THEN -金额 ELSE 0 END) AS 应收余额
FROM (
    SELECT d.客户编号, d.客户名称, '出货' AS 类型, ISNULL(d.金额,0) AS 金额
      FROM [销售出货明细单] d JOIN [销售出货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '退货', ISNULL(d.金额,0)
      FROM [销售退货明细单] d JOIN [销售退货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '收款', ISNULL(d.收款金额,0)
      FROM [销售收款明细单] d JOIN [销售收款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t
WHERE @客户编号 IS NULL OR 客户编号=@客户编号
GROUP BY 客户编号
ORDER BY 客户编号;";

    public async Task<IReadOnlyList<ReceivableRow>> ListAsync(string? 客户编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<ReceivableRow>(Sql, new { 客户编号 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim() });
        return rows.AsList();
    }

    // per-invoice 派生:每张销售出货单 应收/退货/已收/余额(均审核'1')
    private const string PerInvoice = @"
SELECT s.[单号] AS 出货单号, s.[日期] AS 出货日期, s.[客户编号], s.[客户名称],
       ISNULL(o.应收,0) AS 应收金额, ISNULL(r.退货,0) AS 退货金额, ISNULL(p.已收,0) AS 已收金额,
       ISNULL(o.应收,0)-ISNULL(r.退货,0)-ISNULL(p.已收,0) AS 未核销余额
FROM [销售出货单] s
LEFT JOIN (SELECT [单号],SUM(ISNULL([金额],0)) 应收 FROM [销售出货明细单] GROUP BY [单号]) o ON o.[单号]=s.[单号]
LEFT JOIN (SELECT d.[销售单号],SUM(ISNULL(d.[金额],0)) 退货 FROM [销售退货明细单] d JOIN [销售退货单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[销售单号]) r ON r.[销售单号]=s.[单号]
LEFT JOIN (SELECT d.[出仓单号],SUM(ISNULL(d.[收款金额],0)) 已收 FROM [销售收款明细单] d JOIN [销售收款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[出仓单号]) p ON p.[出仓单号]=s.[单号]
WHERE ISNULL(s.[审核],'0')='1'";

    public async Task<IReadOnlyList<ReceivableSettlementRow>> SettlementAsync(string? 客户编号, bool 仅未结清)
    {
        var 客 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim();
        var sql = $"SELECT * FROM ({PerInvoice} AND (@客 IS NULL OR s.[客户编号]=@客)) t "
                + (仅未结清 ? "WHERE t.未核销余额 > 0.005 " : "")
                + "ORDER BY t.客户编号, t.出货日期, t.出货单号";
        using var c = factory.Create();
        return (await c.QueryAsync<ReceivableSettlementRow>(sql, new { 客 })).AsList();
    }

    public async Task<IReadOnlyList<ReceivableAgingRow>> AgingAsync(string? 客户编号, DateTime? 基准日)
    {
        var 客 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim();
        var 基准 = 基准日 ?? DateTime.Today;
        var sql = $@"
SELECT t.客户编号, MAX(t.客户名称) AS 客户名称,
  SUM(CASE WHEN d<=30 THEN 余 ELSE 0 END) AS 账龄0_30,
  SUM(CASE WHEN d BETWEEN 31 AND 60 THEN 余 ELSE 0 END) AS 账龄31_60,
  SUM(CASE WHEN d BETWEEN 61 AND 90 THEN 余 ELSE 0 END) AS 账龄61_90,
  SUM(CASE WHEN d>90 THEN 余 ELSE 0 END) AS 账龄90以上,
  SUM(余) AS 合计
FROM (SELECT t.客户编号, t.客户名称, DATEDIFF(day, t.出货日期, @基准) AS d, t.未核销余额 AS 余
      FROM ({PerInvoice} AND (@客 IS NULL OR s.[客户编号]=@客)) t WHERE t.未核销余额 > 0.005) t
GROUP BY t.客户编号 ORDER BY t.客户编号";
        using var c = factory.Create();
        return (await c.QueryAsync<ReceivableAgingRow>(sql, new { 客, 基准 })).AsList();
    }

    public async Task<IReadOnlyList<UnsettledShipmentRow>> UnsettledShipmentsAsync(string 客户编号)
    {
        var sql = $"SELECT t.出货单号,t.出货日期,t.应收金额,t.已收金额,t.未核销余额 FROM ({PerInvoice} AND s.[客户编号]=@客) t WHERE t.未核销余额 > 0.005 ORDER BY t.出货日期, t.出货单号";
        using var c = factory.Create();
        return (await c.QueryAsync<UnsettledShipmentRow>(sql, new { 客 = 客户编号 })).AsList();
    }
}
