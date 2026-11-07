using System.Globalization;
using System.Runtime.CompilerServices;
using Dapper;
using Microsoft.Data.SqlClient;
using ErpApi.Features.Plastics;

namespace ErpApi.Engines.Inventory;

// 原料库存数量沿用各档案的实际计量单位；KG 换算由已保存的配方快照明确给出。
public static class RawMaterialInventorySql
{
    public const string LegacyDated = @"
SELECT h.[日期],N'入库' AS 方向,d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位],d.[数量]
FROM [原料入仓明细单] d JOIN [原料入仓单] h ON h.[单号]=d.[单号] WHERE h.[审核]=N'1'
UNION ALL
SELECT h.[日期],N'出库',d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位],-d.[数量]
FROM [原料退仓明细单] d JOIN [原料退仓单] h ON h.[单号]=d.[单号] WHERE h.[审核]=N'1'
UNION ALL
SELECT h.[日期],N'出库',d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位],-d.[数量]
FROM [原料出库明细单] d JOIN [原料出库单] h ON h.[单号]=d.[单号] WHERE h.[审核]=N'1'
UNION ALL
SELECT h.[日期],N'入库',d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位],d.[数量]
FROM [原料退库明细单] d JOIN [原料退库表] h ON h.[单号]=d.[单号] WHERE h.[审核]=N'1'
UNION ALL
SELECT h.[日期],N'盘点',d.[原料编号],d.[原料名称],d.[产地],d.[每包重量],d.[单位],d.[盈亏数量]
FROM [原料盘点明细单] d JOIN [原料盘点单] h ON h.[单号]=d.[单号] WHERE h.[审核]=N'1'";

    // 启用原料库存台账时冻结无台账的历史期初。以后收发、盘点不能使这笔期初消失。
    public const string Dated = @"
SELECT l.[日期],l.[方向],l.[原料编号],l.[原料名称],l.[产地],
       COALESCE(o.[每库存单位KG],l.[每包重量]) AS 每包重量,
       COALESCE(o.[库存单位],l.[单位]) AS 单位,l.[数量],
       l.[数量]*COALESCE(o.[每库存单位KG],l.[每包重量],0) AS 重量KG
FROM (" + LegacyDated + @") l
LEFT JOIN [原料自动扣料期初] o ON o.[原料编号]=l.[原料编号]
UNION ALL
SELECT CAST('19000101' AS datetime2),N'期初',o.[原料编号],m.[物料名称],m.[产地],
       o.[每库存单位KG],o.[库存单位],o.[期初数量],o.[期初数量]*o.[每库存单位KG]
FROM [原料自动扣料期初] o LEFT JOIN [塑胶原料资料] m ON m.[物料编号]=o.[原料编号]
UNION ALL
SELECT h.[审核日期],N'出库',d.[原料编号],d.[原料名称],m.[产地],
       d.[每库存单位KG],d.[库存单位],-d.[库存数量],-d.[用量KG]
FROM [塑胶采购原料用量] d
JOIN [塑胶采购订单] h ON h.[单号]=d.[采购单号] AND h.[原料扣减版本] IN(1,2)
 AND h.[原料扣减方式] IS NULL AND h.[审核]=N'1'
LEFT JOIN [塑胶原料资料] m ON m.[物料编号]=d.[原料编号]";

    public const string StockRows = @"
SELECT COALESCE(m.[物料编号],s.[原料编号]) AS 原料编号,
       COALESCE(m.[物料名称],s.[原料名称]) AS 原料名称,
       COALESCE(m.[产地],s.[产地]) AS 产地,
       COALESCE(o.[每库存单位KG],m.[每包重量],s.[每包重量]) AS 每包重量,
       COALESCE(o.[库存单位],m.[单位],s.[单位]) AS 单位,
       ISNULL(s.[库存数量],ISNULL(m.[库存],0)) AS 库存数量,m.[物料类别],
       CAST(CASE WHEN s.[发生次数] IS NULL THEN 0 ELSE 1 END AS bit) AS 有发生
FROM [塑胶原料资料] m
FULL OUTER JOIN (
    SELECT [原料编号],MAX([原料名称]) AS 原料名称,MAX([产地]) AS 产地,
           MAX([每包重量]) AS 每包重量,MAX([单位]) AS 单位,
           SUM(ISNULL([数量],0)) AS 库存数量,COUNT(*) AS 发生次数
    FROM (" + Dated + @") l GROUP BY [原料编号]
) s ON s.[原料编号]=m.[物料编号]
LEFT JOIN [原料自动扣料期初] o ON o.[原料编号]=COALESCE(m.[物料编号],s.[原料编号])";

    public static Task<decimal> StockAsync(SqlConnection c, SqlTransaction? tx, string code) =>
        c.ExecuteScalarAsync<decimal>("SELECT ISNULL(MAX([库存数量]),0) FROM (" + StockRows + ") s WHERE s.[原料编号]=@code",new { code },tx);

    private sealed record Definition(string Detail, int Sign, bool Count = false);
    private static readonly IReadOnlyDictionary<string,Definition> Definitions = new Dictionary<string,Definition>
    {
        ["原料入仓单"] = new("原料入仓明细单",1),
        ["原料退仓单"] = new("原料退仓明细单",-1),
        ["原料出库单"] = new("原料出库明细单",-1),
        ["原料退库表"] = new("原料退库明细单",1),
        ["原料盘点单"] = new("原料盘点明细单",1,true)
    };
    private sealed class StockRow
    {
        public long ID { get; set; }
        public string 原料编号 { get; set; } = "";
        public decimal 数量 { get; set; }
        public decimal 每库存单位KG { get; set; }
        public string 库存单位 { get; set; } = "";
    }
    private sealed class IssueUnit
    {
        public long ID { get; set; }
        public string? 单位 { get; set; }
        public decimal? 每包重量 { get; set; }
        public string? 已存单位 { get; set; }
        public decimal? 已存换算 { get; set; }
    }
    private static readonly ConditionalWeakTable<SqlTransaction,Dictionary<string,string>> Identities = new();

    public static async Task LockCodesAsync(SqlConnection c,SqlTransaction tx,IEnumerable<string> codes)
    {
        foreach (var code in codes.Select(v=>v.Trim().ToUpperInvariant()).Distinct().Order(StringComparer.Ordinal))
        {
            var result = await c.ExecuteScalarAsync<int>(@"
DECLARE @r int;
EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=15000;
SELECT @r;",new { resource="raw-inventory:"+code },tx);
            if (result < 0) throw new InvalidOperationException("原料库存正在过账，请稍后重试。");
        }
    }

    public static async Task LockDocumentAsync(SqlConnection c,SqlTransaction tx,string table,string number)
    {
        if (table != "塑胶采购订单" && !Definitions.ContainsKey(table)) return;
        var rows = await ReadRowsAsync(c,tx,table,number);
        var identity = Identity(rows);
        await LockCodesAsync(c,tx,rows.Select(r=>r.原料编号));
        if (table == "原料出库单") await PlasticRawIssueStockPolicy.LockIssueSourcesAsync(c, tx, number);
        if (identity != Identity(await ReadRowsAsync(c,tx,table,number)))
            throw new InvalidOperationException("原料明细正在修改，请重新打开后再过账。");
        Identities.GetOrCreateValue(tx)[table+"|"+number] = identity;
    }

    public static async Task ValidateSavedAsync(SqlConnection c,SqlTransaction tx,string table,string number,string from,string to)
    {
        if (table != "塑胶采购订单" && !Definitions.ContainsKey(table)) return;
        var state = await c.ExecuteScalarAsync<string?>($"SELECT ISNULL([审核],N'0') FROM [{table}] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number",new { number },tx);
        if (state != from) return;
        var rows = await ReadRowsAsync(c,tx,table,number);
        if (Identities.GetOrCreateValue(tx)[table+"|"+number] != Identity(rows))
            throw new InvalidOperationException("原料明细正在修改，请重新打开后再过账。");
        if (table == "塑胶采购订单" && to == "1")
        {
            await ErpApi.Features.Plastics.PlasticRawConsumptionService.ValidateSavedAsync(c,tx,number);
            foreach (var group in rows.GroupBy(r=>r.原料编号,StringComparer.OrdinalIgnoreCase))
            {
                var first=group.First();
                if (group.Any(r=>r.每库存单位KG!=first.每库存单位KG || r.库存单位!=first.库存单位))
                    throw new InvalidOperationException($"原料 {group.Key} 在本单的库存单位或重量换算不一致，请核对配方后重新保存。");
            }
        }
        // 采购仅核对技术快照；真实领料才占用库存。历史采购负账由审核位与独立方式列保留。
        if (table == "塑胶采购订单") return;
        if (table == "原料出库单" && to == "1")
        {
            await EnsureIssueIsNotAutomaticAsync(c,tx,number);
            await PrepareIssueStockAsync(c, tx, rows);
        }
        var sign = Definitions[table].Sign;
        foreach (var group in rows.GroupBy(r=>r.原料编号,StringComparer.OrdinalIgnoreCase))
        {
            // 未启用自动扣料的旧原料沿用原有过账规则，不重新解释历史单位和负库存。
            if (!await IsEnabledAsync(c,tx,group.Key)) continue;
            var delta = group.Sum(r=>r.数量)*sign*(to=="1"?1:-1);
            if (delta >= 0) continue;
            var stock = await StockAsync(c,tx,group.Key);
            if (stock+delta < 0)
                throw new InvalidOperationException($"原料 {group.Key} 库存不足：现有 {stock:0.########}，本次需要 {-delta:0.########}，缺少 {-delta-stock:0.########}。请补足原料后再审核下发。");
        }
    }

    private static string NormalizeUnit(string? value)
    {
        var unit = value?.Trim().ToUpperInvariant();
        return unit == "公斤" ? "KG" : unit ?? "";
    }

    // 保存的出库数量就是实际库存单位数量；不把KG数静默当成包数，也不修改原申请量。
    private static async Task PrepareIssueStockAsync(SqlConnection c, SqlTransaction tx, IEnumerable<StockRow> rows)
    {
        foreach (var group in rows.GroupBy(x => x.原料编号, StringComparer.OrdinalIgnoreCase))
        {
            var source = await c.QuerySingleOrDefaultAsync<IssueUnit>(@"SELECT m.[ID],m.[单位],m.[每包重量],
o.[库存单位] AS 已存单位,o.[每库存单位KG] AS 已存换算
FROM [塑胶原料资料] m WITH(HOLDLOCK) LEFT JOIN [原料自动扣料期初] o WITH(HOLDLOCK)
ON o.[原料编号]=m.[物料编号] WHERE m.[物料编号]=@code", new { code = group.Key }, tx);
            if (source is null)
                throw new InvalidOperationException($"原料 {group.Key} 没有真实原料档案，不能审核出库。");
            var unit = NormalizeUnit(source.已存单位 ?? source.单位);
            var factor = source.已存换算 ?? (unit == "KG" ? 1m : unit == "包" ? source.每包重量 : null);
            if ((unit != "KG" && unit != "包") || factor is not > 0)
                throw new InvalidOperationException($"原料 {group.Key} 缺少明确的公斤库存单位或每包重量，请核对原料资料后再领料。");
            foreach (var row in group)
            {
                if (row.数量 <= 0)
                    throw new InvalidOperationException($"原料 {group.Key} 的实际领料数量必须大于0。");
                var requested = NormalizeUnit(row.库存单位);
                if ((requested.Length > 0 && requested != unit) ||
                    (unit == "包" && row.每库存单位KG > 0 && row.每库存单位KG != factor.Value))
                    throw new InvalidOperationException($"原料 {group.Key} 的领料单位或每包重量与真实库存 {unit}（每单位{factor.Value:0.########}KG）不一致，请核对后再审核。");
            }
            await FreezeOpeningAsync(c, tx, new StockRow { 原料编号 = group.Key, 库存单位 = unit, 每库存单位KG = factor.Value });
        }
    }

    public static Task<bool> IsEnabledAsync(SqlConnection c,SqlTransaction tx,string code) =>
        c.ExecuteScalarAsync<bool>("SELECT CASE WHEN EXISTS(SELECT 1 FROM [原料自动扣料期初] WHERE [原料编号]=@code) THEN 1 ELSE 0 END",new { code },tx);

    public static Task ActivateAsync(SqlConnection c,SqlTransaction tx,string code,string unit,decimal factor) =>
        FreezeOpeningAsync(c,tx,new StockRow { 原料编号=code,库存单位=unit,每库存单位KG=factor });

    private static async Task FreezeOpeningAsync(SqlConnection c,SqlTransaction tx,StockRow row)
    {
        var existing = await c.QuerySingleOrDefaultAsync<StockRow>("SELECT [库存单位],[每库存单位KG] FROM [原料自动扣料期初] WHERE [原料编号]=@原料编号",row,tx);
        if (existing is not null)
        {
            if (existing.库存单位!=row.库存单位 || existing.每库存单位KG!=row.每库存单位KG)
                throw new InvalidOperationException($"原料 {row.原料编号} 的库存单位换算与既有扣料不一致，请核对配方。");
            return;
        }
        var opening=await c.ExecuteScalarAsync<decimal>(@"
SELECT CASE WHEN EXISTS(SELECT 1 FROM (" + LegacyDated + @") l WHERE l.[原料编号]=@原料编号)
THEN 0 ELSE ISNULL((SELECT MAX([库存]) FROM [塑胶原料资料] WHERE [物料编号]=@原料编号),0) END;",row,tx);
        if (decimal.Abs(opening)>9999999999.99999999m)
            throw new InvalidOperationException($"原料 {row.原料编号} 的历史期初数量超出库存精度，请先核对原料账本。");
        await c.ExecuteAsync(@"
INSERT INTO [原料自动扣料期初]([原料编号],[期初数量],[库存单位],[每库存单位KG],[启用日期])
VALUES(@原料编号,@opening,@库存单位,@每库存单位KG,SYSDATETIME());",
            new { row.原料编号,opening,row.库存单位,row.每库存单位KG },tx);
    }

    private static Task<IEnumerable<StockRow>> ReadRowsAsync(SqlConnection c,SqlTransaction tx,string table,string number)
    {
        if (table == "塑胶采购订单")
            return c.QueryAsync<StockRow>(@"SELECT d.[ID],d.[原料编号],d.[库存数量] AS 数量,d.[库存单位],d.[每库存单位KG]
FROM [塑胶采购原料用量] d JOIN [塑胶采购订单] h ON h.[单号]=d.[采购单号]
WHERE d.[采购单号]=@number AND h.[原料扣减版本] IN(1,2,3)",new { number },tx);
        if (table == "原料出库单")
            return c.QueryAsync<StockRow>(@"SELECT [ID],ISNULL([原料编号],N'') AS 原料编号,ISNULL([数量],0) AS 数量,
ISNULL([单位],N'') AS 库存单位,ISNULL([每包重量],0) AS 每库存单位KG FROM [原料出库明细单] WHERE [单号]=@number", new { number }, tx);
        var definition=Definitions[table];
        return c.QueryAsync<StockRow>($"SELECT [ID],ISNULL([原料编号],N'') AS 原料编号,ISNULL([{(definition.Count?"盈亏数量":"数量")}],0) AS 数量 FROM [{definition.Detail}] WHERE [单号]=@number",new { number },tx);
    }

    private static string Identity(IEnumerable<StockRow> rows) => string.Join("\n",rows.OrderBy(r=>r.ID)
        .Select(r=>$"{r.ID}|{r.原料编号}|{r.数量.ToString(CultureInfo.InvariantCulture)}|{r.库存单位}|{r.每库存单位KG.ToString(CultureInfo.InvariantCulture)}"));

    public static Task EnsureIssueIsNotAutomaticAsync(SqlConnection c,SqlTransaction tx,string number, bool requireApproved = true)
        => PlasticRawIssueStockPolicy.ValidateIssueSourcesAsync(c, tx, number, requireApproved);
}
