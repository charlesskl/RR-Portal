using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

public sealed partial class PlasticRawMaterialStockIssueService
{
    private sealed class IssuedSourceLine
    {
        public string 来源 { get; set; } = "";
        public string 原料编号 { get; set; } = "";
        public string 单号 { get; set; } = "";
        public DateTime? 日期 { get; set; }
        public decimal 数量 { get; set; }
        public string? 单位 { get; set; }
        public decimal? 每包重量 { get; set; }
    }
    private sealed record RawSupplier(string 原料编号, string? 供应商编号, string? 供应商名称, string? 供应商类别);
    private sealed record AutomaticProgress(string SourcesJson, List<PlasticRawMaterialIssueProgressRow> Progress,
        List<PlasticRawMaterialIssueProgressDetailRow> Details, List<PlasticRawMaterialOutsourceShortageRow> Shortages);

    private static bool ReportSearch(string? keyword, params string?[] values) => string.IsNullOrWhiteSpace(keyword)
        || values.Any(value => value?.Contains(keyword.Trim(), StringComparison.OrdinalIgnoreCase) == true);
    private static bool ReportDate(DateTime? value, DateTime? start, DateTime? end) =>
        (!start.HasValue || value.HasValue && value.Value >= start.Value.Date) &&
        (!end.HasValue || value.HasValue && value.Value < end.Value.Date.AddDays(1));

    private static async Task<AutomaticProgress> ReadAutomaticProgressAsync(SqlConnection c)
    {
        var sources = (await RawMaterialProcurementPolicy.ReadAllMoldingSourcesAsync(c, null)).Where(x => x.单头.快照有效).ToArray();
        var numbers = JsonSerializer.Serialize(sources.Select(x => x.单头.单号));
        var issued = (await c.QueryAsync<IssuedSourceLine>(@"SELECT resolved.[来源],d.[原料编号],d.[单号],h.[日期],d.[数量],d.[单位],d.[每包重量]
FROM [原料出库明细单] d JOIN [原料出库单] h ON h.[单号]=d.[单号]
OUTER APPLY(SELECT COUNT(DISTINCT p.[单号]) AS n,MAX(p.[单号]) AS source FROM [塑胶采购订单] p
 WHERE p.[单号]=LTRIM(RTRIM(d.[啤机生产单号])) OR p.[单号]=LTRIM(RTRIM(d.[啤机外发单号]))) old
CROSS APPLY(SELECT COALESCE(d.[来源啤机采购单号],CASE WHEN old.n=1 THEN old.source END) AS 来源) resolved
WHERE h.[审核]=N'1' AND resolved.[来源] IN(SELECT [value] FROM OPENJSON(@numbers))", new { numbers })).ToLookup(x => (x.来源.ToUpperInvariant(), x.原料编号.ToUpperInvariant()));
        var codes = JsonSerializer.Serialize(sources.SelectMany(x => x.明细).Select(x => x.原料编号).Distinct(StringComparer.OrdinalIgnoreCase));
        var suppliers = (await c.QueryAsync<RawSupplier>(@"SELECT m.[物料编号] AS 原料编号,m.[供应商编号],
COALESCE(NULLIF(m.[供应商名称],N''),s.[供应商名称]) AS 供应商名称,s.[供应商类别]
FROM [塑胶原料资料] m LEFT JOIN [供应商资料] s ON s.[供应商编号]=m.[供应商编号]
WHERE m.[物料编号] IN(SELECT [value] FROM OPENJSON(@codes))", new { codes })).ToLookup(x => x.原料编号, StringComparer.OrdinalIgnoreCase);
        var progress = new List<PlasticRawMaterialIssueProgressRow>();
        var details = new List<PlasticRawMaterialIssueProgressDetailRow>();
        var shortages = new List<PlasticRawMaterialOutsourceShortageRow>();
        foreach (var source in sources)
        foreach (var raw in source.明细)
        {
            var h = source.单头;
            var deliveries = issued[(h.单号.ToUpperInvariant(), raw.原料编号.ToUpperInvariant())].ToArray();
            if (deliveries.Any(x => PlasticRawMaterialIssueSourcePolicy.NormalizeUnit(x.单位) != raw.库存单位 ||
                raw.库存单位 == "包" && x.每包重量 != raw.每库存单位KG))
                throw new InvalidOperationException($"啤机采购单 {h.单号} 原料 {raw.原料编号} 的已领历史单位或包重与冻结需求不一致，请核对后查询进度。");
            var total = deliveries.Sum(x => x.数量);
            var owing = raw.需求库存数量 - total;
            progress.Add(new()
            {
                来源类型 = "啤机采购快照", 来源啤机采购单号 = h.单号, 开单日期 = h.日期, 需求单号 = h.单号,
                啤机生产单号 = h.单号, 领料备注 = "生产领料", 原料编号 = raw.原料编号, 原料名称 = raw.原料名称,
                单位 = raw.库存单位, 需求数量 = raw.需求库存数量, 已出库数量 = total, 欠数 = owing,
                进度 = raw.需求库存数量 == 0 ? null : decimal.Round(total * 100m / raw.需求库存数量, 2),
                最后出库日期 = deliveries.Select(x => x.日期).DefaultIfEmpty().Max(), 审核 = h.审核
            });
            var grouped = deliveries.GroupBy(x => new { x.单号, x.日期 }).Select(g => new { g.Key.单号, g.Key.日期, 数量 = g.Sum(x => x.数量) }).ToArray();
            if (grouped.Length == 0)
                details.Add(new() { 来源类型 = "啤机采购快照", 来源啤机采购单号 = h.单号, 开单日期 = h.日期, 啤机生产单号 = h.单号,
                    领料备注 = "生产领料", 原料编号 = raw.原料编号, 原料名称 = raw.原料名称, 单位 = raw.库存单位,
                    需求数量 = raw.需求库存数量, 合计已领数量 = 0, 未领数量 = owing, 审核 = h.审核 });
            foreach (var delivery in grouped)
                details.Add(new() { 来源类型 = "啤机采购快照", 来源啤机采购单号 = h.单号, 开单日期 = h.日期, 啤机生产单号 = h.单号,
                    领料备注 = "生产领料", 原料编号 = raw.原料编号, 原料名称 = raw.原料名称, 单位 = raw.库存单位,
                    需求数量 = raw.需求库存数量, 啤机外发单号 = h.单号, 领料日期 = delivery.日期, 领料单号 = delivery.单号,
                    领料数量 = delivery.数量, 合计已领数量 = total, 未领数量 = owing, 审核 = h.审核 });
            if (h.审核 == "1")
            {
                var supplier = suppliers[raw.原料编号].SingleOrDefault();
                shortages.Add(new() { 来源类型 = "啤机采购快照", 供应商编号 = supplier?.供应商编号, 供应商名称 = supplier?.供应商名称,
                    供应商类别 = supplier?.供应商类别, 原料编号 = raw.原料编号, 原料名称 = raw.原料名称, 单位 = raw.库存单位, 发外欠数 = owing });
            }
        }
        shortages = shortages.GroupBy(x => new { x.供应商编号, x.供应商名称, x.供应商类别, x.原料编号, x.原料名称, x.单位 }).Select(g => new PlasticRawMaterialOutsourceShortageRow
        { 来源类型 = "啤机采购快照", 供应商编号 = g.Key.供应商编号, 供应商名称 = g.Key.供应商名称, 供应商类别 = g.Key.供应商类别,
            原料编号 = g.Key.原料编号, 原料名称 = g.Key.原料名称, 单位 = g.Key.单位, 发外欠数 = g.Sum(x => x.发外欠数) }).ToList();
        return new(numbers, progress, details, shortages);
    }
}
