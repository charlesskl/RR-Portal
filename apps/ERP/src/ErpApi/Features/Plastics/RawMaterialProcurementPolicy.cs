using System.Runtime.CompilerServices;
using System.Text.Json;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

// 所有新采购入口及终审使用同一个KG预算。查询不激活期初，也不修改历史快照。
public static partial class RawMaterialProcurementPolicy
{
    public const int Version = 1;
    private const decimal MaximumQuantity = 9999999999.9999m;
    private static readonly ConditionalWeakTable<SqlTransaction, Dictionary<string, string>> LockedPurchases = new();
    internal static string NormalizeUnit(string? unit) => unit?.Trim().ToUpperInvariant() switch { "公斤" => "KG", var value => value ?? "" };

    // 调用方先持原料/单头业务锁。手工权限与岗位权限都在最终事务内保持稳定。
    public static async Task RequirePermissionAsync(SqlConnection c, SqlTransaction tx, string user,
        PermissionAction action, IPermissionService? permissions = null)
    {
        if (string.IsNullOrWhiteSpace(user)) throw new UnauthorizedAccessException("未识别当前账号。");
        await c.QueryAsync<long>("SELECT [ID] FROM [sysfileuser] WITH(HOLDLOCK) WHERE [用户]=@user", new { user }, tx);
        await c.QueryAsync<long>("SELECT [ID] FROM [userbqrpower] WITH(HOLDLOCK) WHERE [用户]=@user", new { user }, tx);
        bool allowed;
        if (permissions is not null)
            allowed = await permissions.HasAsync(c, tx, user, PlasticRawMaterialPurchaseOrderService.DocType, action);
        else
        {
            var actor = await RawMaterialActorAccess.ResolveAsync(c, tx, user);
            allowed = actor.IsValid && actor.EffectivePermissions.GetValueOrDefault(PlasticRawMaterialPurchaseOrderService.DocType)?.Has(action) == true;
        }
        if (!allowed) throw new UnauthorizedAccessException($"当前账号没有原料采购订单{action}权限。");
    }

    private sealed class Definition
    {
        public long ID { get; set; }
        public string 原料编号 { get; set; } = "";
        public string? 原料名称 { get; set; }
        public string? 规格 { get; set; }
        public string? 物料类别 { get; set; }
        public string? 单位 { get; set; }
        public decimal? 每包重量 { get; set; }
        public bool? 常用原料 { get; set; }
        public decimal? 安全库存 { get; set; }
        public decimal 库存数量 { get; set; }
        public string? 冻结单位 { get; set; }
        public decimal? 冻结换算 { get; set; }
        public string StockUnit => NormalizeUnit(冻结单位 ?? 单位);
        public decimal? Factor => 冻结换算 ?? (StockUnit == "KG" ? 1m : StockUnit == "包" ? 每包重量 : null);
        public decimal? BagWeight => StockUnit == "包" && 冻结换算 is > 0 ? 冻结换算 : 每包重量;
    }

    private sealed class QuantityRow
    {
        public string 单号 { get; set; } = "";
        public string? 来源 { get; set; }
        public string 原料编号 { get; set; } = "";
        public string? 单位 { get; set; }
        public decimal 数量 { get; set; }
        public decimal? 每包重量 { get; set; }
        public decimal? 每库存单位KG { get; set; }
        public int? 采购政策版本 { get; set; }
    }

    public static async Task<IReadOnlyList<PlasticRawMaterialPurchaseRow>> ReadAnalysisAsync(
        SqlConnection c, SqlTransaction? tx, string? category = null, string? keyword = null, bool onlyBuy = false, string? excludeOrder = null,
        IReadOnlyCollection<string>? materialCodes = null)
    {
        // 先读取完整需求及采购占用再筛选；查询关键字不改变分配基数。
        // 写事务仅读取本次原料的完整业务链，避免两个无关原料改单互读对方单头锁。
        var codes = materialCodes is null ? null : JsonSerializer.Serialize(materialCodes);
        var definitions = (await c.QueryAsync<Definition>("""
SELECT m.[ID],m.[物料编号] AS 原料编号,m.[物料名称] AS 原料名称,m.[规格],m.[物料类别],m.[单位],m.[每包重量],m.[常用原料],m.[安全库存],
 ISNULL(s.[库存数量],0) AS 库存数量,o.[库存单位] AS 冻结单位,o.[每库存单位KG] AS 冻结换算
FROM [塑胶原料资料] m
LEFT JOIN (
""" + RawMaterialInventorySql.StockRows + """
) s ON s.[原料编号]=m.[物料编号]
LEFT JOIN [原料自动扣料期初] o ON o.[原料编号]=m.[物料编号]
WHERE (@codes IS NULL OR m.[物料编号] IN(SELECT [value] FROM OPENJSON(@codes)))
ORDER BY m.[物料编号]
""", new { codes }, tx)).AsList();
        var byCode = definitions.GroupBy(x => x.原料编号, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);
        var sources = (await ReadSourcesAsync(c, tx, approvedOnly: true, codes: codes)).Where(x => x.单头.可采购).ToList();
        var issued = (await c.QueryAsync<QuantityRow>("""
SELECT d.[单号],COALESCE(NULLIF(LTRIM(RTRIM(d.[来源啤机采购单号])),N''),CASE WHEN oldSource.SourceCount=1 THEN oldSource.SourceNumber END) AS 来源,
 d.[原料编号],d.[单位],ISNULL(d.[数量],0) AS 数量,d.[每包重量]
FROM [原料出库明细单] d JOIN [原料出库单] h ON h.[单号]=d.[单号] AND h.[审核]=N'1'
OUTER APPLY(SELECT COUNT(*) AS SourceCount,MIN(p.[单号]) AS SourceNumber FROM [塑胶采购订单] p
 WHERE p.[单号]=NULLIF(LTRIM(RTRIM(d.[啤机外发单号])),N'') OR p.[单号]=NULLIF(LTRIM(RTRIM(d.[啤机生产单号])),N'')) oldSource
WHERE COALESCE(NULLIF(LTRIM(RTRIM(d.[来源啤机采购单号])),N''),CASE WHEN oldSource.SourceCount=1 THEN oldSource.SourceNumber END)
 IN(SELECT [value] FROM OPENJSON(@sources))
 AND (@codes IS NULL OR d.[原料编号] IN(SELECT [value] FROM OPENJSON(@codes)))
""", new { sources = JsonSerializer.Serialize(sources.Select(x => x.单头.单号)), codes }, tx)).ToLookup(x => ((x.来源 ?? "").ToUpperInvariant(), x.原料编号.ToUpperInvariant()));
        var demand = new Dictionary<string, (decimal Total, decimal Issued, decimal Remaining)>(StringComparer.OrdinalIgnoreCase);
        var errors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in sources)
        foreach (var line in source.明细)
        {
            var actual = 0m;
            foreach (var row in issued[(source.单头.单号.ToUpperInvariant(), line.原料编号.ToUpperInvariant())])
            {
                var kg = Kilograms(row, null);
                if (kg is null) errors[line.原料编号] = "已领记录缺少明确单位或每包重量，请先核对真实原单。";
                else actual += kg.Value;
            }
            var old = demand.GetValueOrDefault(line.原料编号);
            demand[line.原料编号] = (old.Total + line.需求数量KG, old.Issued + actual, old.Remaining + Math.Max(0, line.需求数量KG - actual));
        }

        var orders = (await c.QueryAsync<QuantityRow>("""
SELECT d.[单号],d.[原料编号],d.[单位],ISNULL(d.[订货数量],0) AS 数量,d.[每包重量],d.[每库存单位KG],h.[采购政策版本]
FROM [原料采购订单明细] d JOIN [原料采购订单] h ON h.[单号]=d.[单号]
WHERE (@excludeOrder IS NULL OR d.[单号]<>@excludeOrder)
 AND (@codes IS NULL OR d.[原料编号] IN(SELECT [value] FROM OPENJSON(@codes)))
""", new { excludeOrder, codes }, tx)).AsList();
        var receipts = (await c.QueryAsync<QuantityRow>("""
SELECT h.[订单单号] AS 单号,d.[原料编号],d.[单位],ISNULL(d.[数量],0) AS 数量,d.[每包重量]
FROM [原料入仓明细单] d JOIN [原料入仓单] h ON h.[单号]=d.[单号] AND h.[审核]=N'1'
WHERE ISNULL(d.[备品],N'0')<>N'1' AND NULLIF(LTRIM(RTRIM(h.[订单单号])),N'') IS NOT NULL
 AND (@codes IS NULL OR d.[原料编号] IN(SELECT [value] FROM OPENJSON(@codes)))
""", new { codes }, tx)).ToLookup(x => (x.单号.ToUpperInvariant(), x.原料编号.ToUpperInvariant()));
        var transit = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        // 同一采购同一原料先汇总，再减一次收货；不逐重复明细重复扣同一笔入仓。
        foreach (var group in orders.GroupBy(x => (x.单号.ToUpperInvariant(), x.原料编号.ToUpperInvariant())))
        {
            var code = group.First().原料编号;
            var definition = byCode.TryGetValue(code, out var found) && found.Count == 1 ? found[0] : null;
            var ordered = 0m;
            var received = 0m;
            foreach (var row in group)
            {
                var kg = Kilograms(row, definition);
                if (kg is null) errors[code] = "已保存采购缺少明确单位或每包重量，请核对原采购单后再下单。";
                else ordered += kg.Value;
            }
            foreach (var row in receipts[group.Key])
            {
                var kg = Kilograms(row, definition);
                if (kg is null) errors[code] = "已入仓记录缺少明确单位或每包重量，请核对原单。";
                else received += kg.Value;
            }
            transit[code] = transit.GetValueOrDefault(code) + Math.Max(0, ordered - received);
        }

        var result = new List<PlasticRawMaterialPurchaseRow>();
        foreach (var definition in definitions)
        {
            var code = definition.原料编号;
            var factor = definition.Factor;
            var totals = demand.GetValueOrDefault(code);
            var stockKg = factor is > 0 ? definition.库存数量 * factor.Value : (decimal?)null;
            var onOrder = transit.GetValueOrDefault(code);
            var gap = stockKg is null ? (decimal?)null : Math.Max(0, totals.Remaining - stockKg.Value - onOrder);
            string? error = errors.GetValueOrDefault(code);
            if (byCode[code].Count != 1) error = "原料编号不唯一，请先核对原料主档。";
            if (definition.StockUnit is not ("KG" or "包") || factor is not > 0 || (definition.StockUnit == "KG" && factor != 1))
                error = "原料缺少明确的公斤库存单位或每包重量，请先完善原料资料。";
            var common = definition.常用原料 == true;
            if (!common && definition.BagWeight is not > 0) error ??= "不常用原料须填写明确的每包重量，才能核对最多额外两包的限制。";
            var maximumKg = common ? null : gap is > 0 && definition.BagWeight is > 0 ? gap + 2m * definition.BagWeight : 0m;
            var maximum = maximumKg is not null && factor is > 0 ? maximumKg / factor : null;
            if (definition.StockUnit == "包" && maximum is not null) maximum = decimal.Floor(maximum.Value);
            else if (maximum is not null) maximum = decimal.Floor(maximum.Value * 10000m) / 10000m;
            if (!common && gap == 0) error ??= "库存及已保存采购已覆盖需求，无需再次采购。";
            // 常用原料保留显式安全库存补库建议，手工补库仍可超过建议；不常用不自动套安全库存。
            var recommendationKg = stockKg is null ? (decimal?)null : Math.Max(0,
                totals.Remaining + (common ? Math.Max(0, definition.安全库存 ?? 0) * factor!.Value : 0) - stockKg.Value - onOrder);
            var recommendation = factor is > 0 && recommendationKg is not null ? recommendationKg / factor : null;
            if (definition.StockUnit == "包" && recommendation is not null) recommendation = decimal.Ceiling(recommendation.Value);
            else if (recommendation is not null) recommendation = decimal.Ceiling(recommendation.Value * 10000m) / 10000m;
            if (recommendation is not null && maximum is not null) recommendation = Math.Min(recommendation.Value, maximum.Value);
            result.Add(new()
            {
                原料编号 = code, 原料名称 = definition.原料名称, 规格 = definition.规格, 物料类别 = definition.物料类别, 单位 = definition.StockUnit,
                常用原料 = definition.常用原料, 每包重量 = definition.BagWeight, 安全库存 = definition.安全库存,
                当前库存 = definition.库存数量, 生产需求 = factor is > 0 ? totals.Remaining / factor : null,
                在途数量 = factor is > 0 ? onOrder / factor : null, 可购数量 = recommendation,
                需求数量KG = totals.Total, 已领数量KG = totals.Issued, 待领数量KG = totals.Remaining,
                当前库存KG = stockKg, 在途数量KG = onOrder, 缺口数量KG = gap,
                可购上限KG = maximumKg, 可购上限 = maximum, 采购限制原因 = error
            });
        }
        var kw = keyword?.Trim();
        return result.Where(x => (string.IsNullOrWhiteSpace(category) || x.物料类别 == category.Trim()) &&
            (string.IsNullOrWhiteSpace(kw) || x.原料编号?.Contains(kw, StringComparison.OrdinalIgnoreCase) == true || x.原料名称?.Contains(kw, StringComparison.OrdinalIgnoreCase) == true) &&
            (!onlyBuy || x.可购数量 > 0)).ToList();
    }

    private static decimal? Kilograms(QuantityRow row, Definition? definition)
    {
        var unit = NormalizeUnit(row.单位);
        if (unit == "KG") return row.数量;
        if (unit != "包") return null;
        // 新采购沿用自己的冻结换算。历史包采购只用明确包重/已冻结库存换算，不猜25KG。
        var frozenBagFactor = NormalizeUnit(definition?.冻结单位) == "包" ? definition?.冻结换算 : null;
        var factor = row.每库存单位KG ?? row.每包重量 ?? frozenBagFactor;
        return factor is > 0 ? row.数量 * factor : null;
    }

    public static async Task PrepareForSaveAsync(SqlConnection c, SqlTransaction tx,
        IReadOnlyList<PlasticRawMaterialPurchaseOrderCreateLineDto> lines, string? excludeOrder = null)
    {
        if (lines.Count == 0) throw new ArgumentException("原料采购订单至少要有一行明细。");
        await RawMaterialInventorySql.LockCodesAsync(c, tx, lines.Select(x => x.原料编号).OfType<string>());
        var analysis = (await ReadAnalysisAsync(c, tx, excludeOrder: excludeOrder,
            materialCodes: lines.Select(x => x.原料编号?.Trim() ?? "").Distinct(StringComparer.OrdinalIgnoreCase).ToArray()))
            .ToDictionary(x => x.原料编号!, StringComparer.OrdinalIgnoreCase);
        foreach (var group in lines.GroupBy(x => x.原料编号?.Trim() ?? "", StringComparer.OrdinalIgnoreCase))
        {
            if (!analysis.TryGetValue(group.Key, out var row)) throw new InvalidOperationException($"原料 {group.Key} 没有真实原料档案，请重新选择。");
            if (row.采购限制原因 is not null) throw new InvalidOperationException($"原料 {group.Key}：{row.采购限制原因}");
            foreach (var line in group)
            {
                if (line.订货数量 <= 0 || line.订货数量 > MaximumQuantity || decimal.Round(line.订货数量, 4) != line.订货数量)
                    throw new ArgumentException($"原料 {group.Key} 的订货数量必须大于0且最多四位小数。");
                var unit = NormalizeUnit(line.单位);
                if (unit != row.单位) throw new InvalidOperationException($"原料 {group.Key} 的采购单位须与库存单位 {row.单位} 一致，请重新选择原料。");
                if (unit == "包" && decimal.Truncate(line.订货数量) != line.订货数量)
                    throw new InvalidOperationException($"原料 {group.Key} 按包采购须填写整包数量。");
                line.原料编号 = row.原料编号;
                line.原料名称 = row.原料名称;
                line.单位 = unit;
                line.每库存单位KG = unit == "KG" ? 1 : row.每包重量;
                line.每包重量 = row.每包重量;
                line.采购政策版本 = Version;
            }
            var total = group.Sum(x => x.订货数量);
            if (row.常用原料 != true && (row.可购上限 is null || total > row.可购上限))
                throw new InvalidOperationException($"原料 {group.Key} 为不常用原料，本次合计最多采购 {row.可购上限:0.####}{row.单位}（实际缺口加最多2包），请减少数量。");
        }
    }

    // 在采购头锁之前调用，避免采购改单与终审反向等待；随后最终校验再次比较明细身份。
    public static async Task LockPurchaseAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var rows = await ReadPurchaseLinesAsync(c, tx, number);
        await RawMaterialInventorySql.LockCodesAsync(c, tx, rows.Select(x => x.原料编号).OfType<string>());
        var identity = PurchaseIdentity(rows);
        if (identity != PurchaseIdentity(await ReadPurchaseLinesAsync(c, tx, number)))
            throw new InvalidOperationException("原料采购明细正在修改，请重新打开后再审核。");
        LockedPurchases.GetOrCreateValue(tx)[number] = identity;
    }

    public static async Task ValidateForApprovalAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var version = await c.ExecuteScalarAsync<int?>("SELECT [采购政策版本] FROM [原料采购订单] WHERE [单号]=@number", new { number }, tx);
        if (version is null) return; // 历史采购不因部署被重新解释。
        if (version != Version) throw new InvalidOperationException("不支持的原料采购政策版本，请核对单据。");
        var lines = await ReadPurchaseLinesAsync(c, tx, number);
        if (!LockedPurchases.GetOrCreateValue(tx).TryGetValue(number, out var identity) || identity != PurchaseIdentity(lines))
            throw new InvalidOperationException("原料采购明细尚未完成事务锁定，请重新审核。");
        var originalFactors = lines.Select(x => (x.每库存单位KG, x.每包重量, x.采购政策版本)).ToArray();
        await PrepareForSaveAsync(c, tx, lines, number);
        if (!originalFactors.SequenceEqual(lines.Select(x => (x.每库存单位KG, x.每包重量, x.采购政策版本))))
            throw new InvalidOperationException("原料采购的包重或单位换算已变更，请明确修改原单并重新审批。");
    }

    private static async Task<List<PlasticRawMaterialPurchaseOrderCreateLineDto>> ReadPurchaseLinesAsync(SqlConnection c, SqlTransaction tx, string number)
        => (await c.QueryAsync<PlasticRawMaterialPurchaseOrderCreateLineDto>("""
SELECT d.[原料编号],d.[原料名称],d.[单位],d.[订货数量],d.[每库存单位KG],d.[每包重量],d.[采购政策版本]
FROM [原料采购订单明细] d WHERE d.[单号]=@number ORDER BY d.[ID]
""", new { number }, tx)).AsList();

    private static string PurchaseIdentity(IEnumerable<PlasticRawMaterialPurchaseOrderCreateLineDto> rows)
        => JsonSerializer.Serialize(rows.Select(x => new { x.原料编号, x.单位, x.订货数量, x.每库存单位KG, x.每包重量, x.采购政策版本 }));
}
