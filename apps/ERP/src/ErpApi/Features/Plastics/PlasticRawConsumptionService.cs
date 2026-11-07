using System.Diagnostics;
using System.Text.Json;
using Dapper;
using ErpApi.Engines.Inventory;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

// 配方只在新单保存时解释；已保存用量与终审始终读取冻结快照。
public static partial class PlasticRawConsumptionService
{
    internal const decimal MaximumKg = 99999999999999.9999m;
    private const decimal MaximumStockQuantity = 9999999999.99999999m;
    private sealed class MaterialSource
    {
        public string 物料编号 { get; set; } = "";
        public string? 用料名称 { get; set; }
        public decimal? 单件克重 { get; set; }
        public long? 原料ID { get; set; }
    }

    private static bool Injection(string? stage, string? process) => string.IsNullOrWhiteSpace(process)
        && (string.IsNullOrWhiteSpace(stage) || stage.Trim() == "一次加工");

    public static async Task<List<PlasticRawPreviewLine>> PreviewAsync(SqlConnection c, SqlTransaction? tx,
        string? stage, string? process, IReadOnlyList<PlasticRawPreviewLineRequest> lines, bool lockRecipes = true)
    {
        if (!Injection(stage, process)) return lines.Select(x => new PlasticRawPreviewLine { 物料编号 = x.物料编号 }).ToList();
        if (tx is not null && lockRecipes) await PlasticRawRecipeService.LockRecipesAsync(c, tx, write: false);
        var codes = lines.Select(x => x.物料编号.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var sources = (await c.QueryAsync<MaterialSource>(@"SELECT m.[物料编号],m.[用料名称],
COALESCE(m.[原胶件单净重],m.[整啤净重]/NULLIF(m.[出模数],0)) AS 单件克重,r.[ID] AS 原料ID
FROM [塑胶物料资料] m LEFT JOIN [塑胶原料资料] r ON r.[物料名称]=m.[用料名称]
WHERE m.[物料编号] IN(SELECT [value] FROM OPENJSON(@codes))", new { codes = JsonSerializer.Serialize(codes) }, tx)).AsList();
        var byCode = sources.GroupBy(x => x.物料编号, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);
        var result = new List<PlasticRawPreviewLine>();
        foreach (var line in lines)
        {
            var row = new PlasticRawPreviewLine { 物料编号 = line.物料编号 };
            result.Add(row);
            if (!byCode.TryGetValue(line.物料编号.Trim(), out var matches)) continue;
            if (matches.Count != 1)
            {
                row.原料配比错误 = $"物料 {line.物料编号} 的塑胶档案或用料名称关联不唯一，请核对真实原料。";
                continue;
            }
            var source = matches[0];
            row.单件克重 = source.单件克重;
            var mixed = source.用料名称?.IndexOfAny(['+', '＋']) >= 0;
            if (source.原料ID is null)
            {
                if (mixed) row.原料配比错误 = $"物料 {line.物料编号} 的混合用料未精确对应原料资料，请先设置真实原料配方。";
                continue;
            }
            var components = (await c.QueryAsync<PlasticRawConsumptionSnapshot>(@"SELECT d.[原料ID],m.[物料编号] AS 原料编号,
ISNULL(m.[物料名称],N'') AS 原料名称,d.[比例],d.[库存单位],d.[每库存单位KG]
FROM [塑胶原料配方明细] d LEFT JOIN [塑胶原料资料] m ON m.[ID]=d.[原料ID]
WHERE d.[配方原料ID]=@parent ORDER BY m.[物料编号],d.[原料ID]", new { parent = source.原料ID.Value }, tx)).AsList();
            if (components.Count == 0)
            {
                if (mixed) row.原料配比错误 = $"物料 {line.物料编号} 的混合用料尚未设置组分配比，审核下发前请完善原料配方。";
                continue;
            }
            if (components.Any(x => string.IsNullOrWhiteSpace(x.原料编号) || x.原料编号.Length > 40 || x.原料名称.Length > 80 ||
                x.比例 <= 0 || x.每库存单位KG <= 0))
            {
                row.原料配比错误 = $"物料 {line.物料编号} 的原料配方存在无效成员，请重新核对原料资料。";
                continue;
            }
            if (source.单件克重 is not > 0)
            {
                row.原料配比错误 = $"物料 {line.物料编号} 缺少有效单件克重，不能计算原料用量。";
                continue;
            }
            var totalKg = decimal.Round(line.数量 * source.单件克重.Value / 1000m, 4, MidpointRounding.AwayFromZero);
            if (totalKg < 0 || totalKg > MaximumKg)
            {
                row.原料配比错误 = $"物料 {line.物料编号} 的原料用量超出可保存范围，请核对数量及单件克重。";
                continue;
            }
            Allocate(components, totalKg);
            if (components.Any(x => x.库存数量 > MaximumStockQuantity ||
                (x.用量KG > 0 && x.库存数量 == 0) || decimal.Abs(x.库存数量 * x.每库存单位KG - x.用量KG) > 0.00005m))
            {
                row.原料配比错误 = $"物料 {line.物料编号} 的库存数量或换算精度超出可保存范围，请核对原料配方。";
                continue;
            }
            row.原料组成 = components;
        }
        return result;
    }

    // 以万分之一 KG 为整数分配，最大余数补尾差，稳定排序保证重复预览与保存一致。
    private static void Allocate(List<PlasticRawConsumptionSnapshot> rows, decimal totalKg)
    {
        var totalRatio = rows.Sum(x => x.比例);
        var totalUnits = totalKg * 10000m;
        var parts = rows.Select((row, index) =>
        {
            var exact = totalUnits * row.比例 / totalRatio;
            return (index, whole: decimal.Truncate(exact), remainder: exact - decimal.Truncate(exact));
        }).ToList();
        var extras = decimal.ToInt32(totalUnits - parts.Sum(x => x.whole));
        var winners = parts.OrderByDescending(x => x.remainder).ThenBy(x => x.index).Take(extras).Select(x => x.index).ToHashSet();
        for (var i = 0; i < rows.Count; i++)
        {
            rows[i].总比例 = totalRatio;
            rows[i].用量KG = (parts[i].whole + (winners.Contains(i) ? 1 : 0)) / 10000m;
            rows[i].库存数量 = decimal.Round(rows[i].用量KG / rows[i].每库存单位KG, 8, MidpointRounding.AwayFromZero);
        }
        Debug.Assert(rows.Sum(x => x.用量KG) == totalKg);
    }

    public static Task<IReadOnlyList<PlasticRawConsumptionSnapshot>> ReadSavedAsync(SqlConnection c, SqlTransaction? tx, string number)
        => ReadSavedCoreAsync(c, tx, number);

    private static async Task<IReadOnlyList<PlasticRawConsumptionSnapshot>> ReadSavedCoreAsync(SqlConnection c, SqlTransaction? tx, string number)
        => (await c.QueryAsync<PlasticRawConsumptionSnapshot>(@"SELECT [采购明细ID],[原料ID],[原料编号],[原料名称],[比例],[总比例],
[用量KG],[库存数量],[库存单位],[每库存单位KG] FROM [塑胶采购原料用量] WHERE [采购单号]=@number ORDER BY [采购明细ID],[原料编号]", new { number }, tx)).AsList();

    public static async Task<IReadOnlyList<string>> ReadDocumentCodesAsync(SqlConnection c, SqlTransaction? tx, string number)
        => (await ReadSavedCoreAsync(c, tx, number)).Select(x => x.原料编号).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public static async Task FillStockAsync(SqlConnection c, SqlTransaction? tx, IEnumerable<PlasticRawConsumptionSnapshot> rows)
    {
        foreach (var group in rows.GroupBy(x => x.原料编号, StringComparer.OrdinalIgnoreCase))
        {
            var stock = await RawMaterialInventorySql.StockAsync(c, tx, group.Key);
            foreach (var row in group) row.库存KG = stock * row.每库存单位KG;
        }
    }

    public static async Task InsertAsync(SqlConnection c, SqlTransaction tx, string number, long lineId, PlasticRawPreviewLine row)
    {
        if (row.原料核算版本 is 2 or 3)
            await c.ExecuteAsync(@"UPDATE [塑胶采购订单明细] SET [原料编号]=@原料编号,[原料名称]=@原料名称,[原料用量KG]=@原料用量KG,
[原料组号]=@原料组号,[原料组主行]=@原料组主行,[原料组成员数]=@原料组成员数,[核算套数]=@核算套数,[核算出模数]=@核算出模数,
[核算整啤净重]=@核算整啤净重,[核算啤数]=@核算啤数,[核算模具编号]=@核算模具编号,[核算模具名称]=@核算模具名称,[原料组净重KG]=@原料组净重KG
WHERE [ID]=@lineId AND [单号]=@number", new
            {
                lineId, number, row.原料编号, row.原料名称, row.原料用量KG, row.原料组号, row.原料组主行,
                row.原料组成员数, row.核算套数, row.核算出模数, row.啤货订单数量, row.啤货总用量, row.啤货颜色数, row.啤货公式说明, row.啤货用量文本, row.核算整啤净重, row.核算啤数, row.核算模具编号, row.核算模具名称, row.原料组净重KG
            }, tx);
        await c.ExecuteAsync("UPDATE [塑胶采购订单明细] SET [原料配比错误]=@error,[原料扣减组分数]=@count WHERE [ID]=@lineId AND [单号]=@number",
            new { error = row.原料配比错误, count = row.原料组成.Count, lineId, number }, tx);
        foreach (var part in row.原料组成)
            await c.ExecuteAsync(@"INSERT INTO [塑胶采购原料用量]([采购单号],[采购明细ID],[原料ID],[原料编号],[原料名称],
[比例],[总比例],[用量KG],[库存数量],[库存单位],[每库存单位KG])
VALUES(@number,@lineId,@原料ID,@原料编号,@原料名称,@比例,@总比例,@用量KG,@库存数量,@库存单位,@每库存单位KG)",
                new { number, lineId, part.原料ID, part.原料编号, part.原料名称, part.比例, part.总比例, part.用量KG, part.库存数量, part.库存单位, part.每库存单位KG }, tx);
    }

    public static async Task ValidateSavedAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var version = await c.ExecuteScalarAsync<int?>("SELECT [原料扣减版本] FROM [塑胶采购订单] WHERE [单号]=@number", new { number }, tx);
        if (version is null) return;
        Debug.Assert(version is 1 or 2 or 3);
        var error = await c.ExecuteScalarAsync<string?>(@"SELECT TOP(1) [原料配比错误] FROM [塑胶采购订单明细]
WHERE [单号]=@number AND [原料配比错误] IS NOT NULL ORDER BY [ID]", new { number }, tx);
        if (error is not null) throw new InvalidOperationException(error);
        var invalid = await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM [塑胶采购原料用量] s
LEFT JOIN [塑胶采购订单明细] d ON d.[ID]=s.[采购明细ID] AND d.[单号]=s.[采购单号]
WHERE s.[采购单号]=@number AND (d.[ID] IS NULL OR s.[比例]<=0 OR s.[总比例]<=0 OR s.[用量KG]<0 OR s.[库存数量]<0 OR s.[每库存单位KG]<=0
 OR (s.[用量KG]>0 AND s.[库存数量]=0) OR ABS(s.[库存数量]*s.[每库存单位KG]-s.[用量KG])>0.00005)", new { number }, tx);
        if (invalid > 0) throw new InvalidOperationException("原料用量快照不完整，请重新打开采购单核对后保存。");
        var inconsistent = await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM [塑胶采购订单明细] d
OUTER APPLY(SELECT COUNT(*) AS Members,SUM(s.[用量KG]) AS Kg,SUM(s.[比例]) AS Ratios,MIN(s.[总比例]) AS TotalRatio,MAX(s.[总比例]) AS MaxTotalRatio
 FROM [塑胶采购原料用量] s WHERE s.[采购单号]=d.[单号] AND s.[采购明细ID]=d.[ID]) s
WHERE d.[单号]=@number AND (d.[原料扣减组分数] IS NULL OR d.[原料扣减组分数]<>s.Members
 OR (s.Members>0 AND (d.[原料用量KG] IS NULL OR s.Kg<>d.[原料用量KG] OR s.Ratios<>s.TotalRatio OR s.TotalRatio<>s.MaxTotalRatio)))", new { number }, tx);
        if (inconsistent > 0) throw new InvalidOperationException("原料用量快照与采购明细不一致，请重新核对采购单后保存。");
        if (version is 2 or 3) await ValidateMoldingGroupsSavedAsync(c, tx, number, version.Value);
        if (await c.ExecuteScalarAsync<bool>(@"SELECT CASE WHEN EXISTS(
SELECT 1 FROM [塑胶采购订单] h JOIN [塑胶采购原料用量] s ON s.[采购单号]=h.[单号]
WHERE h.[单号]=@number AND (NULLIF(LTRIM(RTRIM(h.[加工内容])),N'') IS NOT NULL
 OR COALESCE(NULLIF(LTRIM(RTRIM(h.[加工类型])),N''),N'一次加工')<>N'一次加工')) THEN 1 ELSE 0 END", new { number }, tx))
            throw new InvalidOperationException("只有啤机采购单可以扣原料，请核对加工工序与原料用量快照。");
    }
}
