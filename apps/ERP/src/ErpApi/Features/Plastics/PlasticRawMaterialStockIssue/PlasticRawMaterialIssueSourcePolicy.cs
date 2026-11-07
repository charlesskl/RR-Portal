using Dapper;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

// 新申请以明确来源占用冻结净量；未审及反审申请不释放，删除才释放。
public static class PlasticRawMaterialIssueSourcePolicy
{
    private sealed class RequestedLine
    {
        public string? 来源啤机采购单号 { get; set; }
        public string? 原料编号 { get; set; }
        public string? 单位 { get; set; }
        public decimal? 每包重量 { get; set; }
        public decimal 数量 { get; set; }
    }

    public static string NormalizeUnit(string? value) => value?.Trim().ToUpperInvariant() is "公斤" ? "KG" : value?.Trim().ToUpperInvariant() ?? "";

    public static async Task NormalizeNewSourcesAsync(SqlConnection c, SqlTransaction tx,
        IEnumerable<PlasticRawMaterialStockIssueCreateLineDto> lines)
    {
        foreach (var line in lines)
        {
            if (line.数量 <= 0 || line.数量 > 9999999999.99999999m || decimal.Round(line.数量, 8) != line.数量 ||
                (line.每包重量.HasValue && (line.每包重量 < 0 || line.每包重量 > 9999999999.99999999m || decimal.Round(line.每包重量.Value, 8) != line.每包重量.Value)))
                throw new ArgumentException("原料领料数量必须大于0，数量和每包重量最多保留8位小数且不得超出范围。");
            line.来源啤机采购单号 = string.IsNullOrWhiteSpace(line.来源啤机采购单号) ? null : line.来源啤机采购单号.Trim();
            var candidates = new[] { line.来源啤机采购单号, line.啤机外发单号?.Trim(), line.啤机生产单号?.Trim() }
                .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (candidates.Length == 0) continue;
            var matches = (await c.QueryAsync<string>("SELECT [单号] FROM [塑胶采购订单] WHERE [单号] IN @candidates", new { candidates }, tx))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (matches.Length > 1)
                throw new ArgumentException("同一原料领料行的啤机采购来源互相冲突，请重新选择来源。");
            if (line.来源啤机采购单号 is not null && !matches.Contains(line.来源啤机采购单号, StringComparer.OrdinalIgnoreCase))
                throw new ArgumentException($"来源啤机采购单 {line.来源啤机采购单号} 不存在。");
            if (matches.Length == 0) continue; // 无真实 SP 关系的手工单保持原身份。
            line.来源啤机采购单号 = matches[0];
            if (!string.IsNullOrWhiteSpace(line.啤机外发单号) && !line.啤机外发单号.Trim().Equals(matches[0], StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("啤机外发单号与明确采购来源不一致。");
            line.啤机外发单号 = matches[0];
            line.单位 = NormalizeUnit(line.单位);
        }
    }

    public static async Task<PlasticRawMaterialIssueSourceDetail?> ReadAsync(SqlConnection c, SqlTransaction? tx, string source, bool approvedOnly = true)
    {
        var saved = await RawMaterialProcurementPolicy.ReadMoldingSourceAsync(c, tx, source, approvedOnly);
        if (saved is null) return null;
        if (!saved.单头.快照有效)
            throw new InvalidOperationException(saved.单头.限制原因 ?? "来源啤机采购单没有有效原料快照。");
        var applications = (await ReadApplicationsAsync(c, tx, source)).ToArray();
        var result = new PlasticRawMaterialIssueSourceDetail { 单号 = saved.单头.单号 };
        foreach (var row in saved.明细)
        {
            var unit = NormalizeUnit(row.库存单位);
            var used = applications.Where(x => string.Equals(x.原料编号, row.原料编号, StringComparison.OrdinalIgnoreCase)).ToArray();
            foreach (var application in used) EnsureUnit(application, unit, row.每库存单位KG, row.原料编号);
            var requested = used.Sum(x => x.数量);
            result.明细.Add(new()
            {
                原料编号 = row.原料编号, 原料名称 = row.原料名称, 单位 = unit, 每包重量 = row.每库存单位KG, 每库存单位KG = row.每库存单位KG,
                需求数量KG = row.需求数量KG, 需求数量 = row.需求库存数量, 已申请数量 = requested,
                可申请数量 = Math.Max(0, row.需求库存数量 - requested)
            });
        }
        return result;
    }

    public static async Task ValidateSavedAsync(SqlConnection c, SqlTransaction tx, string number)
    {
        var lines = (await c.QueryAsync<RequestedLine>(@"SELECT [来源啤机采购单号],[原料编号],[单位],[每包重量],[数量]
FROM [原料出库明细单] WITH(UPDLOCK,HOLDLOCK) WHERE [单号]=@number AND [来源啤机采购单号] IS NOT NULL", new { number }, tx)).ToArray();
        foreach (var group in lines.GroupBy(x => x.来源啤机采购单号!, StringComparer.OrdinalIgnoreCase).OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase))
        {
            await RawMaterialSourceLock.LockDocumentAsync(c, tx, group.Key);
            var source = await ReadAsync(c, tx, group.Key, approvedOnly: false)
                ?? throw new InvalidOperationException($"来源啤机采购单 {group.Key} 不可领料，请选择具有有效原料快照的纯啤机单。");
            foreach (var line in group)
            {
                var row = source.明细.SingleOrDefault(x => string.Equals(x.原料编号, line.原料编号, StringComparison.OrdinalIgnoreCase));
                if (row is null) throw new InvalidOperationException($"原料 {line.原料编号} 不属于来源啤机采购单 {group.Key} 的冻结用料。");
                EnsureUnit(line, row.单位, row.每包重量, row.原料编号);
                if (line.数量 <= 0) throw new InvalidOperationException("原料领料数量必须大于0。");
                if (row.已申请数量 > row.需求数量)
                    throw new InvalidOperationException($"啤机采购单 {group.Key} 原料 {row.原料编号} 累计申请 {row.已申请数量:0.########}{row.单位} 超过冻结净需求 {row.需求数量:0.########}{row.单位}；待审及反审申请仍占用额度。");
            }
        }
    }

    private static void EnsureUnit(RequestedLine line, string unit, decimal factor, string code)
    {
        if (NormalizeUnit(line.单位) != unit || factor <= 0 ||
            (unit == "包" && line.每包重量 != factor) ||
            (line.来源啤机采购单号 is not null && unit == "KG" && line.每包重量 != 1m))
            throw new InvalidOperationException($"原料 {code} 的领料单位或每包重量与来源采购冻结换算不一致，请核对来源。");
    }

    private static async Task<IEnumerable<RequestedLine>> ReadApplicationsAsync(SqlConnection c, SqlTransaction? tx, string source)
    {
        // 旧关系只有明确字段精确指向同一真实 SP 时才纳入；一行只计一次，不从单号前缀或名称推测。
        var hold = tx is null ? "" : "WITH(UPDLOCK,HOLDLOCK)";
        var ambiguous = await c.ExecuteScalarAsync<int>($@"SELECT COUNT(*) FROM [原料出库明细单] d {hold}
WHERE d.[来源啤机采购单号] IS NULL
AND (LTRIM(RTRIM(d.[啤机外发单号]))=@source OR LTRIM(RTRIM(d.[啤机生产单号]))=@source)
AND EXISTS(SELECT 1 FROM [塑胶采购订单] p WHERE p.[单号]<>@source
 AND (p.[单号]=LTRIM(RTRIM(d.[啤机外发单号])) OR p.[单号]=LTRIM(RTRIM(d.[啤机生产单号]))))", new { source }, tx);
        if (ambiguous > 0) throw new InvalidOperationException($"啤机采购单 {source} 存在来源冲突的历史领料，请先核对，不能猜算剩余额度。");
        return await c.QueryAsync<RequestedLine>($@"SELECT d.[来源啤机采购单号],d.[原料编号],d.[单位],d.[每包重量],d.[数量]
FROM [原料出库明细单] d {hold}
WHERE d.[来源啤机采购单号]=@source OR (d.[来源啤机采购单号] IS NULL
AND (LTRIM(RTRIM(d.[啤机外发单号]))=@source OR LTRIM(RTRIM(d.[啤机生产单号]))=@source))", new { source }, tx);
    }
}
