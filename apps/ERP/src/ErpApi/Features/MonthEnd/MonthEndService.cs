using Dapper;
using ErpApi.Infrastructure.Db;
using System;
namespace ErpApi.Features.MonthEnd;

// 月结（库存滚存快照）。复用 P5 同一 UNION 账本，加日期谓词一次算 期初/本期入/本期出；结存=期初+本期入-本期出。
// 软月结：只写快照不锁单据。仅数量、无金额。
public sealed class MonthEndService(ISqlConnectionFactory factory)
{
    // ---- 成品账本：款号×色号×颜色×尺码，过滤明细 审核'1'，明细自带 日期。盘点盈亏按符号计入入/出。----
    private const string 成品账本Sql = @"
WITH 账本 AS (
    SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)      AS 签 FROM [成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)      FROM [成品退货明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)*-1   FROM [成品出仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)*-1   FROM [成品退仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(盈亏数量,0)   FROM [成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)      FROM [成品调拨明细单] WHERE 目标仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码,[日期], ISNULL(数量,0)*-1   FROM [成品调拨明细单] WHERE 源仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT d.款号,N'',CAST(NULL AS nvarchar(20)),d.颜色,CAST(NULL AS nvarchar(10)),COALESCE(d.[日期],h.[日期]),
                     (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1
                FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号
                WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
)
SELECT 款号, MAX(款式) AS 款式, 色号, 颜色, 尺码,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出
FROM 账本
GROUP BY 款号,色号,颜色,尺码
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;";

    // ---- 半成品账本：物料编号×颜色，明细无审核列→JOIN 单头按 h.审核 过滤；盘点盈亏 real→CAST decimal。----
    private const string 半成品账本Sql = @"
WITH 账本 AS (
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,d.[日期], ISNULL(d.数量,0)    AS 签
      FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,d.[日期], ISNULL(d.数量,0)*-1
      FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,d.[日期], ISNULL(d.数量,0)*-1
      FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,d.[日期], CAST(ISNULL(d.盈亏数量,0) AS decimal(18,4))
      FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色,COALESCE(d.[日期],h.[日期]),
           (CASE WHEN d.已出数量 IS NOT NULL THEN d.已出数量 ELSE d.数量 END)*-1
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND (ISNULL(d.已出数量,0)>0 OR ISNULL(h.审核,'0')='1')
)
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, 颜色,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出
FROM 账本
GROUP BY 物料编号,颜色
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;";

    private const string InsertSql = @"
INSERT INTO [结存快照表]([年月],[仓库],[口径],[款号],[款式],[色号],[颜色],[尺码],[物料编号],[物料名称],[规格],[单位],[期初],[本期入],[本期出],[结存],[期初金额],[本期入金额],[本期出金额],[结存金额],[加权单价],[生成时间])
VALUES(@年月,@仓库,@口径,@款号,@款式,@色号,@颜色,@尺码,@物料编号,@物料名称,@规格,@单位,@期初,@本期入,@本期出,@结存,@期初金额,@本期入金额,@本期出金额,@结存金额,@加权单价,@生成时间);";

    private static (DateTime 月初, DateTime 下月初) ParsePeriod(string 年月)
    {
        if (string.IsNullOrWhiteSpace(年月) || 年月.Length != 6 || !int.TryParse(年月, out _))
            throw new ArgumentException("年月须为 6 位 yyyyMM。");
        var y = int.Parse(年月[..4]); var m = int.Parse(年月[4..]);
        if (m < 1 || m > 12) throw new ArgumentException("年月的月份须在 01–12 之间。");
        var 月初 = new DateTime(y, m, 1);
        return (月初, 月初.AddMonths(1));
    }
    private static string NormalizeKind(string 口径)
    {
        var k = (口径 ?? "").Trim();
        if (k != "成品" && k != "半成品" && k != "物料") throw new ArgumentException("口径须为 成品 / 半成品 / 物料。");
        return k;
    }

    public async Task<MonthEndCloseResult> CloseAsync(MonthEndCloseRequest req, string user)
    {
        var (月初, 下月初) = ParsePeriod(req.年月);
        var 口径 = NormalizeKind(req.口径);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 目标仓库：传仓库=单仓；否则该口径当月(及以前)有审核流水的全部仓库
        List<string> whs = string.IsNullOrWhiteSpace(req.仓库)
            ? (await c.QueryAsync<string>(
                口径 == "成品" ? 成品仓库Sql : 口径 == "半成品" ? 半成品仓库Sql : 物料仓库Sql, new { 下月初 }, tx)).ToList()
            : [req.仓库.Trim()];
        if (whs.Count == 0) { tx.Commit(); return new MonthEndCloseResult { 结数 = 0, 仓库 = whs }; }

        // 冲突：任一仓该口径该月已结 → 整批拒绝（要求先反月结）
        var conflicts = (await c.QueryAsync<string>(
            @"SELECT 仓库 FROM [结存快照表] WITH (UPDLOCK, HOLDLOCK)
              WHERE 年月=@年月 AND 口径=@口径 AND 仓库 IN @whs GROUP BY 仓库",
            new { 年月 = req.年月, 口径, whs }, tx)).ToList();
        if (conflicts.Count > 0)
            throw new InvalidOperationException($"以下仓库 {req.年月} 该口径已结，请先反月结：{string.Join("、", conflicts)}");

        int 结数 = 0;
        var ledger = 口径 == "成品" ? 成品账本Sql : 口径 == "半成品" ? 半成品账本Sql : 物料账本Sql;
        foreach (var wh in whs)
        {
            var rows = (await c.QueryAsync<MonthEndRow>(ledger, new { 仓 = wh, 月初, 下月初 }, tx)).ToList();

            // 物料口径：全月一次加权平均。期初金额取上期快照结存金额（序贯）。
            Dictionary<string, decimal> 期初金额表 = new();
            if (口径 == "物料")
            {
                var prior = await c.QueryAsync(物料期初金额Sql, new { 仓 = wh, 年月 = req.年月 }, tx);
                foreach (var p in prior)
                    期初金额表[(string)p.物料编号] = (decimal)p.结存金额;
            }

            foreach (var r in rows)
            {
                r.年月 = req.年月; r.仓库 = wh; r.口径 = 口径;
                r.结存 = r.期初 + r.本期入 - r.本期出;
                if (口径 == "物料")
                {
                    var 期初额 = (r.物料编号 != null && 期初金额表.TryGetValue(r.物料编号, out var pv)) ? pv : 0m;
                    var 入额 = r.本期入金额 ?? 0m;
                    var 分母 = r.期初 + r.本期入;
                    var 加权 = 分母 > 0 ? (期初额 + 入额) / 分母 : 0m;
                    r.期初金额 = 期初额;
                    r.本期入金额 = 入额;
                    r.加权单价 = decimal.Round(加权, 4);
                    r.本期出金额 = decimal.Round(r.本期出 * r.加权单价.Value, 4);
                    r.结存金额 = 期初额 + 入额 - r.本期出金额.Value;
                }
                await c.ExecuteAsync(InsertSql, new
                {
                    r.年月, r.仓库, r.口径, r.款号, r.款式, r.色号, r.颜色, r.尺码,
                    r.物料编号, r.物料名称, r.规格, r.单位, r.期初, r.本期入, r.本期出, r.结存,
                    r.期初金额, r.本期入金额, r.本期出金额, r.结存金额, r.加权单价, 生成时间 = now
                }, tx);
                结数++;
            }
        }
        tx.Commit();
        return new MonthEndCloseResult { 结数 = 结数, 仓库 = whs };
    }

    // ---- 仓库发现（缺省全仓 close 用）----
    private const string 成品仓库Sql = @"
SELECT DISTINCT 仓库 FROM (
    SELECT 仓库 FROM [成品入仓明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 仓库 FROM [成品退货明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 仓库 FROM [成品出仓明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 仓库 FROM [成品退仓明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 仓库 FROM [成品盘点明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 目标仓库 FROM [成品调拨明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
    UNION SELECT 源仓库   FROM [成品调拨明细单] WHERE ISNULL(审核,'0')='1' AND [日期] < @下月初
) t WHERE 仓库 IS NOT NULL AND 仓库 <> N'';";

    private const string 半成品仓库Sql = @"
SELECT DISTINCT 仓库 FROM (
    SELECT d.仓库 FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
) t WHERE 仓库 IS NOT NULL AND 仓库 <> N'';";

    // ---- 物料(原料)账本：物料编号×仓库(忽略颜色，与 MaterialInventoryService 一致)。审核在单头→JOIN 单头。----
    // 采购入仓分支按 数量+备品数量 计(备品是实物入库;金额只计订单部分,备品免费)。
    private const string 物料账本Sql = @"
WITH 账本 AS (
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)+ISNULL(d.备品数量,0) AS 签, ISNULL(d.金额,0) AS 金额签
      FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0),    ISNULL(d.金额,0)
      FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)*-1, 0
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
)
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, MAX(单位) AS 单位,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN 金额签 ELSE 0 END)         AS 本期入金额
FROM 账本
GROUP BY 物料编号
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;";

    private const string 物料仓库Sql = @"
SELECT DISTINCT 仓库 FROM (
    SELECT d.仓库 FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
) t WHERE 仓库 IS NOT NULL AND 仓库 <> N'';";

    // ---- 物料期初金额：上一期快照(同仓+口径'物料'，年月<当前的最近一条)的结存金额。无上期→该物料编号取0。----
    private const string 物料期初金额Sql = @"
SELECT s.物料编号, s.结存金额
FROM [结存快照表] s
JOIN (
    SELECT 物料编号, MAX(年月) AS m
    FROM [结存快照表]
    WHERE 仓库=@仓 AND 口径=N'物料' AND 年月 < @年月
    GROUP BY 物料编号
) x ON x.物料编号 = s.物料编号 AND x.m = s.年月
WHERE s.仓库=@仓 AND s.口径=N'物料' AND s.年月 < @年月;";

    public async Task<int> ReopenAsync(MonthEndReopenRequest req, string user)
    {
        ParsePeriod(req.年月);                 // 校验年月格式
        var 口径 = NormalizeKind(req.口径);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        List<string> whs = string.IsNullOrWhiteSpace(req.仓库)
            ? (await c.QueryAsync<string>(
                "SELECT DISTINCT 仓库 FROM [结存快照表] WHERE 年月=@年月 AND 口径=@口径", new { 年月 = req.年月, 口径 }, tx)).ToList()
            : [req.仓库.Trim()];
        if (whs.Count == 0) { tx.Commit(); return 0; }

        // 护栏：存在更晚月份的快照则拒绝（年月为 yyyyMM，字符串比较=时序比较）
        var later = (await c.QueryAsync<string>(
            "SELECT DISTINCT 仓库 FROM [结存快照表] WHERE 口径=@口径 AND 年月 > @年月 AND 仓库 IN @whs",
            new { 年月 = req.年月, 口径, whs }, tx)).ToList();
        if (later.Count > 0)
            throw new InvalidOperationException($"以下仓库存在更晚月份的快照，不能反月结：{string.Join("、", later)}");

        var n = await c.ExecuteAsync(
            "DELETE FROM [结存快照表] WHERE 年月=@年月 AND 口径=@口径 AND 仓库 IN @whs",
            new { 年月 = req.年月, 口径, whs }, tx);
        tx.Commit();
        return n;
    }

    public async Task<IReadOnlyList<MonthEndRow>> ReportAsync(string 年月, string 口径, string? 仓库)
    {
        var k = NormalizeKind(口径);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MonthEndRow>(@"
SELECT [年月],[仓库],[口径],[款号],[款式],[色号],[颜色],[尺码],[物料编号],[物料名称],[规格],[单位],[期初],[本期入],[本期出],[结存],[期初金额],[本期入金额],[本期出金额],[结存金额],[加权单价]
FROM [结存快照表]
WHERE [年月]=@年月 AND [口径]=@k AND (@仓库 IS NULL OR [仓库]=@仓库)
ORDER BY [仓库],[款号],[物料编号],[色号],[颜色],[尺码]",
            new { 年月, k, 仓库 = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim() });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<string>> PeriodsAsync(string 口径)
    {
        var k = NormalizeKind(口径);
        using var c = factory.Create();
        var rows = await c.QueryAsync<string>(
            "SELECT DISTINCT [年月] FROM [结存快照表] WHERE [口径]=@k ORDER BY [年月] DESC", new { k });
        return rows.AsList();
    }
}
