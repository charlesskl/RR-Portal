using System.Text.Json;
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Features.Plastics.PlasticRawMaterialDemand;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

public static partial class RawMaterialProcurementPolicy
{
    private const string PureMoldingSql = "NULLIF(LTRIM(RTRIM(h.[加工内容])),N'') IS NULL AND COALESCE(NULLIF(LTRIM(RTRIM(h.[加工类型])),N''),N'一次加工')=N'一次加工'";

    private sealed class SourceHeader : MoldingHeaderData
    {
        public bool 自动扣料 { get; set; }
        public string? 快照错误 { get; set; }
        public int 错误明细数 { get; set; }
    }

    private class MoldingHeaderData
    {
        public string 单号 { get; set; } = "";
        public DateTime? 日期 { get; set; }
        public string? 供应商编号 { get; set; }
        public string? 供应商名称 { get; set; }
        public string? 审核 { get; set; }
        public int? 原料扣减版本 { get; set; }
    }

    private sealed class SourcePart
    {
        public string 采购单号 { get; set; } = "";
        public long 原料ID { get; set; }
        public string 原料编号 { get; set; } = "";
        public string 原料名称 { get; set; } = "";
        public decimal 用量KG { get; set; }
        public decimal 库存数量 { get; set; }
        public string 库存单位 { get; set; } = "";
        public decimal 每库存单位KG { get; set; }
        public bool 来源明细存在 { get; set; }
    }

    public static async Task<PagedResult<MoldingRawSourceHeader>> ReadMoldingSourcesAsync(
        SqlConnection c, SqlTransaction? tx, int page, int size, string? keyword, bool approvedOnly = false)
    {
        page = Math.Max(1, page);
        size = Math.Clamp(size, 1, 100);
        var sources = await ReadSourcesAsync(c, tx, null, keyword, approvedOnly);
        var eligible = sources.Where(x => !approvedOnly || x.单头.可采购).ToList();
        return new PagedResult<MoldingRawSourceHeader>(eligible.Skip((page - 1) * size).Take(size).Select(x => x.单头).ToList(), eligible.Count);
    }

    public static async Task<MoldingRawSourceDetail?> ReadMoldingSourceAsync(
        SqlConnection c, SqlTransaction? tx, string number, bool approvedOnly = false)
    {
        var result = (await ReadSourcesAsync(c, tx, number.Trim(), null, approvedOnly)).SingleOrDefault();
        return approvedOnly && result?.单头.可采购 != true ? null : result;
    }

    public static async Task<IReadOnlyList<MoldingRawSourceDetail>> ReadAllMoldingSourcesAsync(
        SqlConnection c, SqlTransaction? tx, bool approvedOnly = false)
        => (await ReadSourcesAsync(c, tx, approvedOnly: approvedOnly)).Where(x => !approvedOnly || x.单头.可采购).ToList();

    private static async Task<List<MoldingRawSourceDetail>> ReadSourcesAsync(
        SqlConnection c, SqlTransaction? tx, string? number = null, string? keyword = null, bool approvedOnly = false, string? codes = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : "%" + keyword.Trim() + "%";
        var headers = (await c.QueryAsync<SourceHeader>($"""
SELECT h.[单号],h.[日期],h.[供应商编号],h.[供应商名称],h.[审核],h.[原料扣减版本],
 CAST(CASE WHEN h.[审核]=N'1' AND h.[原料扣减方式] IS NULL AND h.[原料扣减版本] IN(1,2)
  AND EXISTS(SELECT 1 FROM [塑胶采购原料用量] s WHERE s.[采购单号]=h.[单号] AND s.[库存数量]>0) THEN 1 ELSE 0 END AS bit) AS 自动扣料,
 (SELECT TOP(1) d.[原料配比错误] FROM [塑胶采购订单明细] d WHERE d.[单号]=h.[单号] AND NULLIF(d.[原料配比错误],N'') IS NOT NULL ORDER BY d.[ID]) AS 快照错误,
 (SELECT COUNT(*) FROM [塑胶采购订单明细] d
  OUTER APPLY(SELECT COUNT(*) AS Members,SUM(s.[用量KG]) AS Kg FROM [塑胶采购原料用量] s WHERE s.[采购单号]=d.[单号] AND s.[采购明细ID]=d.[ID]) p
  WHERE d.[单号]=h.[单号] AND (d.[原料扣减组分数] IS NULL OR d.[原料扣减组分数]<>p.Members
   OR (p.Members>0 AND (d.[原料用量KG] IS NULL OR d.[原料用量KG]<>p.Kg)))) AS 错误明细数
FROM [塑胶采购订单] h
WHERE {PureMoldingSql} AND (@number IS NULL OR h.[单号]=@number)
 AND (@codes IS NULL OR EXISTS(SELECT 1 FROM [塑胶采购原料用量] r WHERE r.[采购单号]=h.[单号] AND r.[原料编号] IN(SELECT [value] FROM OPENJSON(@codes))))
 AND (@approvedOnly=0 OR h.[审核]=N'1')
 AND (@kw IS NULL OR h.[单号] LIKE @kw OR h.[供应商名称] LIKE @kw OR EXISTS(
  SELECT 1 FROM [塑胶采购原料用量] p WHERE p.[采购单号]=h.[单号] AND (p.[原料编号] LIKE @kw OR p.[原料名称] LIKE @kw)))
ORDER BY h.[日期] DESC,h.[ID] DESC
""", new { number, kw, approvedOnly, codes }, tx)).AsList();
        if (headers.Count == 0) return [];
        var parts = (await c.QueryAsync<SourcePart>("""
SELECT s.[采购单号],s.[原料ID],s.[原料编号],s.[原料名称],s.[用量KG],s.[库存数量],s.[库存单位],s.[每库存单位KG],
 CAST(CASE WHEN d.[ID] IS NULL THEN 0 ELSE 1 END AS bit) AS 来源明细存在
FROM [塑胶采购原料用量] s
LEFT JOIN [塑胶采购订单明细] d ON d.[单号]=s.[采购单号] AND d.[ID]=s.[采购明细ID]
WHERE s.[采购单号] IN(SELECT [value] FROM OPENJSON(@numbers)) ORDER BY s.[ID]
""", new { numbers = JsonSerializer.Serialize(headers.Select(x => x.单号)) }, tx)).ToLookup(x => x.采购单号, StringComparer.OrdinalIgnoreCase);

        return headers.Select(h =>
        {
            var sourceParts = parts[h.单号].ToList();
            var result = new MoldingRawSourceDetail
            {
                单头 = new() { 单号 = h.单号, 日期 = h.日期, 供应商编号 = h.供应商编号, 供应商名称 = h.供应商名称, 审核 = h.审核, 原料扣减版本 = h.原料扣减版本 }
            };
            string? error = h.原料扣减版本 is not (1 or 2 or 3) ? "历史单没有可用的原料冻结快照，不能按当前主档重算。" :
                h.自动扣料 ? "此单已按历史规则自动扣原料，不再生成采购或重复领料需求。" :
                h.快照错误 ?? (h.错误明细数 > 0 ? "原料冻结快照与采购明细不一致，请核对原单。" : null);
            if (sourceParts.Count == 0) error ??= "此单没有有效原料组分快照，请先完善啤机单。";
            foreach (var group in sourceParts.GroupBy(x => x.原料编号, StringComparer.OrdinalIgnoreCase))
            {
                var first = group.First();
                var unit = NormalizeUnit(first.库存单位);
                if (string.IsNullOrWhiteSpace(group.Key) || group.Any(x => !x.来源明细存在 || x.用量KG < 0 || x.库存数量 < 0 ||
                    x.每库存单位KG <= 0 || x.原料ID != first.原料ID || NormalizeUnit(x.库存单位) != unit || x.每库存单位KG != first.每库存单位KG ||
                    Math.Abs(x.库存数量 * x.每库存单位KG - x.用量KG) > 0.00005m) ||
                    unit is not ("KG" or "包") || (unit == "KG" && first.每库存单位KG != 1))
                {
                    error ??= $"原料 {group.Key} 的冻结单位、组分或数量不一致，请核对原单。";
                    continue;
                }
                result.明细.Add(new() { 原料编号 = first.原料编号, 原料名称 = first.原料名称, 需求数量KG = group.Sum(x => x.用量KG),
                    库存单位 = unit, 每库存单位KG = first.每库存单位KG, 需求库存数量 = group.Sum(x => x.库存数量) });
            }
            result.单头.需求数量KG = result.明细.Sum(x => x.需求数量KG);
            result.单头.原料种数 = result.明细.Count;
            result.单头.限制原因 = error ?? (h.审核 != "1" ? "啤机单尚未最终审核，当前需求仅供预估。" : null);
            result.单头.快照有效 = error is null;
            result.单头.可采购 = result.单头.限制原因 is null;
            return result;
        }).ToList();
    }
}
