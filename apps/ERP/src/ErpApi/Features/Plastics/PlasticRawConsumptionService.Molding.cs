using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

public static partial class PlasticRawConsumptionService
{
    private sealed class MoldingSource
    {
        public string 物料编号 { get; set; } = "";
        public string? 工模编号 { get; set; }
        public string? 工模名称 { get; set; }
        public string? 用料名称 { get; set; }
        public decimal? 套数 { get; set; }
        public decimal? 出模数 { get; set; }
        public decimal? 整啤净重 { get; set; }
        public decimal? 单件克重 { get; set; }
        public long? 原料ID { get; set; }
        public string? 原料编号 { get; set; }
        public string? 原料名称 { get; set; }
        public string? 单位 { get; set; }
        public decimal? 每包重量 { get; set; }
    }

    private sealed record MoldingMember(PlasticRawPreviewLineRequest Input, MoldingSource Source, PlasticRawPreviewLine Output);
    private sealed record MoldingGroup(string Key, List<MoldingMember> Members, List<PlasticRawConsumptionSnapshot> Parts);

    private static string MoldingColorKey(string? powder, string? color) => !string.IsNullOrWhiteSpace(powder)
        ? "P:" + powder.Trim().ToUpperInvariant() : "C:" + (color?.Trim().ToUpperInvariant() ?? "");

    private static string MoldingGroupKey(string mold, string parent, string? powder, string? color)
        => JsonSerializer.Serialize(new[] { mold.Trim().ToUpperInvariant(), parent.Trim().ToUpperInvariant(), MoldingColorKey(powder, color) });

    private static string MoldingMemberKey(PlasticRawPreviewLineRequest row)
        => JsonSerializer.Serialize(new[] { row.物料编号.Trim().ToUpperInvariant(), row.生产单号?.Trim().ToUpperInvariant() ?? "",
            row.款号?.Trim().ToUpperInvariant() ?? "", MoldingColorKey(row.色粉号, row.颜色),
            row.数量.ToString("0.####", CultureInfo.InvariantCulture), row.套数?.ToString("0.####", CultureInfo.InvariantCulture) ?? "" });

    // 版本 2 仅对新保存的纯啤机单解释技术资料。最终审核不会重读主档或当前配方。
    public static async Task<List<PlasticRawPreviewLine>> PreviewMoldingGroupsAsync(SqlConnection c, SqlTransaction? tx,
        string? stage, string? process, IReadOnlyList<PlasticRawPreviewLineRequest> lines, bool lockRecipes = true)
    {
        var result = lines.Select(x => new PlasticRawPreviewLine { 物料编号 = x.物料编号 }).ToList();
        if (!Injection(stage, process)) return result;
        foreach (var row in result) row.原料核算版本 = 3;
        if (tx is not null && lockRecipes) await PlasticRawRecipeService.LockRecipesAsync(c, tx, write: false);
        // 候选预读发生在原料库存锁之前，不能持有源表锁倒置配方写入的锁顺序。
        var sourceLock = tx is not null && lockRecipes ? " WITH(HOLDLOCK)" : "";
        var codes = JsonSerializer.Serialize(lines.Select(x => x.物料编号.Trim()).Distinct(StringComparer.OrdinalIgnoreCase));
        var sources = (await c.QueryAsync<MoldingSource>($@"SELECT m.[物料编号],m.[工模编号],NULLIF(LTRIM(RTRIM(g.[工模名称])),N'') AS 工模名称,m.[用料名称],m.[套数],m.[出模数],m.[整啤净重],
m.[原胶件单净重] AS 单件克重,r.[ID] AS 原料ID,r.[物料编号] AS 原料编号,r.[物料名称] AS 原料名称,r.[单位],r.[每包重量]
FROM [塑胶物料资料] m{sourceLock} LEFT JOIN [塑胶原料资料] r{sourceLock} ON r.[物料名称]=m.[用料名称]
LEFT JOIN [工模表] g{sourceLock} ON g.[工模编号]=m.[工模编号]
WHERE m.[物料编号] IN(SELECT [value] FROM OPENJSON(@codes)) ORDER BY m.[物料编号],r.[ID]", new { codes }, tx)).AsList();
        var byCode = sources.GroupBy(x => x.物料编号, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.ToList(), StringComparer.OrdinalIgnoreCase);
        var members = new List<MoldingMember>();
        for (var i = 0; i < lines.Count; i++)
        {
            var input = lines[i];
            var output = result[i];
            output.核算模具名称 = string.IsNullOrWhiteSpace(input.打印模具名称) ? null : input.打印模具名称.Trim();
            if (!byCode.TryGetValue(input.物料编号.Trim(), out var matches) || matches.Count != 1)
            {
                output.原料配比错误 = $"物料 {input.物料编号} 的塑胶档案或真实原料关联缺失、不唯一，请核对后保存。";
                continue;
            }
            var source = matches[0];
            output.单件克重 = source.单件克重;
            output.原料编号 = source.原料编号?.Trim();
            output.原料名称 = source.原料名称;
            output.核算套数 = input.套数 ?? source.套数;
            output.核算出模数 = source.出模数;
            output.核算整啤净重 = source.整啤净重;
            output.核算模具编号 = source.工模编号?.Trim();
            output.核算模具名称 ??= source.工模名称;
            if (source.原料ID is null || string.IsNullOrWhiteSpace(output.原料编号))
                output.原料配比错误 = $"物料 {input.物料编号} 的用料名称未精确对应真实原料资料，请先核对原料。";
            else if (string.IsNullOrWhiteSpace(output.核算模具编号) || output.核算出模数 is not > 0 || source.整啤净重 is not > 0)
                output.原料配比错误 = $"物料 {input.物料编号} 缺少有效模具编号、出模数或整啤净重，不能核算啤机原料。";
            members.Add(new(input, source, output));
        }

        var plans = new List<MoldingGroup>();
        var groups = members.Where(x => x.Source.原料ID is not null && !string.IsNullOrWhiteSpace(x.Output.核算模具编号))
            .GroupBy(x => MoldingGroupKey(x.Output.核算模具编号!, x.Source.原料ID!.Value.ToString("D20", CultureInfo.InvariantCulture), x.Input.色粉号, x.Input.颜色))
            .OrderBy(x => x.Key, StringComparer.Ordinal).ToList();
        foreach (var group in groups)
        {
            var ordered = group.OrderBy(x => MoldingMemberKey(x.Input), StringComparer.Ordinal).ToList();
            var owner = ordered[0];
            // 显式核对的原单打印名只决定显示，不参与模具身份、啤数或重量核算。
            var printNames = ordered.Select(x => x.Input.打印模具名称?.Trim()).Where(x => !string.IsNullOrEmpty(x))
                .Distinct(StringComparer.Ordinal).ToList();
            if (printNames.Count > 1)
                throw new ArgumentException($"模具 {owner.Output.核算模具编号} 的同组打印模具名称不一致，请核对后填写同一名称。");
            if (printNames.Count == 1)
                foreach (var member in ordered) member.Output.核算模具名称 = printNames[0];
            var groupNumber = plans.Count + 1;
            foreach (var member in ordered)
            {
                member.Output.原料组号 = groupNumber;
                member.Output.原料组主行 = ReferenceEquals(member, owner);
                member.Output.原料组成员数 = ordered.Count;
            }
            var plan = new MoldingGroup(group.Key, ordered, []);
            plans.Add(plan);
            var error = ordered.Select(x => x.Output.原料配比错误).FirstOrDefault(x => x is not null);
            if (error is null && ordered.Any(x => x.Output.核算整啤净重 != owner.Output.核算整啤净重))
                error = $"模具 {owner.Output.核算模具编号} 的同色同原料成员整啤净重不一致，请先核对塑胶资料。";
            if (error is not null)
            {
                SetMoldingError(plan, error);
                continue;
            }
            var shots = MoldingShots(ordered.Select(x => (x.Input.物料编号, x.Input.数量, x.Output.核算出模数!.Value)));
            var whole = owner.Output.核算整啤净重!.Value;
            if (shots > MaximumKg * 1000m / whole)
            {
                SetMoldingError(plan, $"模具 {owner.Output.核算模具编号} 的啤机原料用量超出可保存范围，请核对数量、出模数及整啤净重。");
                continue;
            }
            foreach (var member in ordered) member.Output.核算啤数 = shots;
            var parts = (await c.QueryAsync<PlasticRawConsumptionSnapshot>($@"SELECT d.[原料ID],m.[物料编号] AS 原料编号,
ISNULL(m.[物料名称],N'') AS 原料名称,d.[比例],d.[库存单位],d.[每库存单位KG]
FROM [塑胶原料配方明细] d{sourceLock} LEFT JOIN [塑胶原料资料] m{sourceLock} ON m.[ID]=d.[原料ID]
WHERE d.[配方原料ID]=@parent ORDER BY m.[物料编号],d.[原料ID]", new { parent = owner.Source.原料ID }, tx)).AsList();
            if (parts.Count == 0)
            {
                if (owner.Source.用料名称?.IndexOfAny(['+', '＋']) >= 0)
                {
                    SetMoldingError(plan, $"物料 {owner.Input.物料编号} 的混合用料尚未设置组分配比，审核下发前请完善原料配方。");
                    continue;
                }
                var unit = owner.Source.单位?.Trim().ToUpperInvariant();
                var factor = unit is "KG" or "公斤" ? 1m : unit == "包" ? owner.Source.每包重量 : null;
                if (factor is not > 0)
                {
                    SetMoldingError(plan, $"原料 {owner.Output.原料编号} 缺少明确的公斤单位或每包重量，请先核对原料资料。");
                    continue;
                }
                parts.Add(new()
                {
                    原料ID = owner.Source.原料ID!.Value, 原料编号 = owner.Output.原料编号!, 原料名称 = owner.Output.原料名称 ?? "",
                    比例 = 1, 库存单位 = unit == "包" ? "包" : "KG", 每库存单位KG = factor.Value
                });
            }
            if (parts.Any(x => x.原料ID <= 0 || string.IsNullOrWhiteSpace(x.原料编号) || x.原料编号.Length > 40 ||
                x.原料名称.Length > 80 || x.比例 <= 0 || x.每库存单位KG <= 0) || parts.Sum(x => x.比例) > MaximumKg ||
                parts.Select(x => x.原料ID).Distinct().Count() != parts.Count)
            {
                SetMoldingError(plan, $"物料 {owner.Input.物料编号} 的原料配方存在无效或重复成员，请重新核对原料资料。");
                continue;
            }
            parts.Sort((left, right) =>
            {
                var order = StringComparer.OrdinalIgnoreCase.Compare(left.原料编号, right.原料编号);
                return order != 0 ? order : left.原料ID.CompareTo(right.原料ID);
            });
            plan.Parts.AddRange(parts);
            AllocateMoldingRecipe(plan.Parts, decimal.Round(whole * shots / 1000m, 4, MidpointRounding.AwayFromZero));
        }
        RoundMoldingRawTotals(plans);
        foreach (var plan in plans.Where(x => x.Parts.Count > 0))
        {
            if (plan.Parts.Sum(x => x.用量KG) > MaximumKg || plan.Parts.Any(x => x.库存数量 > MaximumStockQuantity || (x.用量KG > 0 && x.库存数量 == 0) ||
                decimal.Abs(x.库存数量 * x.每库存单位KG - x.用量KG) > 0.00005m))
            {
                SetMoldingError(plan, $"模具 {plan.Members[0].Output.核算模具编号} 的库存数量或换算精度超出可保存范围，请核对原料单位。");
                plan.Parts.Clear();
                continue;
            }
            var net = plan.Parts.Sum(x => x.用量KG);
            foreach (var member in plan.Members) member.Output.原料组净重KG = net;
            plan.Members[0].Output.原料组成 = plan.Parts;
            plan.Members[0].Output.原料用量KG = net;
        }
        return result;
    }

    private static void SetMoldingError(MoldingGroup plan, string error)
    {
        foreach (var member in plan.Members) member.Output.原料配比错误 = error;
    }

    // 同一产物的多生产来源先合计需求；同模不同产物共用最大啤数，只耗一份整模重量。
    private static decimal MoldingShots(IEnumerable<(string Code, decimal Quantity, decimal Capacity)> members)
        => members.GroupBy(x => x.Code.Trim(), StringComparer.OrdinalIgnoreCase)
            .Max(x => decimal.Ceiling(x.Sum(m => m.Quantity / m.Capacity)));

    // 先按真实原料编号汇总整单再圆一位。分回各组仍以万分之一公斤保存，避免每组先圆造成累积误差。
    private static void RoundMoldingRawTotals(IReadOnlyList<MoldingGroup> groups)
    {
        var entries = groups.SelectMany(group => group.Parts.Select(part => (group, part)));
        foreach (var raw in entries.GroupBy(x => x.part.原料ID).OrderBy(x => x.Key))
        {
            var rows = raw.OrderBy(x => x.group.Members[0].Output.原料组号).ToList();
            var sum = rows.Sum(x => x.part.用量KG);
            if (sum == 0) continue;
            var targetUnits = decimal.Round(sum, 1, MidpointRounding.AwayFromZero) * 10000m;
            var weights = rows.Select(x => x.part.用量KG).ToArray();
            var amounts = AllocateMoldingUnits(weights, targetUnits);
            for (var i = 0; i < rows.Count; i++)
            {
                rows[i].part.用量KG = amounts[i] / 10000m;
                rows[i].part.库存数量 = decimal.Round(rows[i].part.用量KG / rows[i].part.每库存单位KG, 8, MidpointRounding.AwayFromZero);
            }
        }
    }

    private static void AllocateMoldingRecipe(List<PlasticRawConsumptionSnapshot> parts, decimal kilograms)
    {
        var totalRatio = parts.Sum(x => x.比例);
        var amounts = AllocateMoldingUnits(parts.Select(x => x.比例).ToArray(), kilograms * 10000m);
        for (var i = 0; i < parts.Count; i++)
        {
            parts[i].总比例 = totalRatio;
            parts[i].用量KG = amounts[i] / 10000m;
            parts[i].库存数量 = decimal.Round(parts[i].用量KG / parts[i].每库存单位KG, 8, MidpointRounding.AwayFromZero);
        }
    }

    private static decimal[] AllocateMoldingUnits(IReadOnlyList<decimal> weights, decimal targetUnits)
    {
        var sum = weights.Sum();
        Debug.Assert(sum > 0 && targetUnits == decimal.Truncate(targetUnits));
        var parts = weights.Select((weight, index) =>
        {
            var exact = weight / sum * targetUnits;
            var whole = decimal.Truncate(exact);
            return (index, whole, remainder: exact - whole);
        }).ToList();
        var extras = decimal.ToInt32(targetUnits - parts.Sum(x => x.whole));
        Debug.Assert(extras >= 0 && extras <= parts.Count);
        var winners = parts.OrderByDescending(x => x.remainder).ThenBy(x => x.index).Take(extras).Select(x => x.index).ToHashSet();
        return parts.Select(x => x.whole + (winners.Contains(x.index) ? 1m : 0m)).ToArray();
    }

    private sealed class SavedMoldingLine
    {
        public long ID { get; set; }
        public string 物料编号 { get; set; } = "";
        public string? 生产单号 { get; set; }
        public string? 款号 { get; set; }
        public string? 色粉号 { get; set; }
        public string? 颜色 { get; set; }
        public string? 原料编号 { get; set; }
        public decimal 数量 { get; set; }
        public decimal? 套数 { get; set; }
        public decimal? 原料用量KG { get; set; }
        public int? 原料组号 { get; set; }
        public bool? 原料组主行 { get; set; }
        public int? 原料组成员数 { get; set; }
        public decimal? 核算套数 { get; set; }
        public decimal? 核算出模数 { get; set; }
        public decimal? 啤货订单数量 { get; set; }
        public decimal? 啤货总用量 { get; set; }
        public int? 啤货颜色数 { get; set; }
        public string? 啤货公式说明 { get; set; }
        public string? 啤货用量文本 { get; set; }
        public decimal? 核算整啤净重 { get; set; }
        public decimal? 核算啤数 { get; set; }
        public string? 核算模具编号 { get; set; }
        public string? 核算模具名称 { get; set; }
        public decimal? 原料组净重KG { get; set; }
    }

    private const string InvalidMoldingSnapshot = "啤机同模原料核算快照不完整或与采购明细不一致，请重新核对采购单后保存。";

    private static async Task ValidateMoldingGroupsSavedAsync(SqlConnection c, SqlTransaction tx, string number, int version)
    {
        var saved = (await c.QueryAsync<SavedMoldingLine>(@"SELECT [ID],[物料编号],[生产单号],[款号],[色粉号],[颜色],[原料编号],
[数量],[套数],[原料用量KG],[原料组号],[原料组主行],[原料组成员数],[核算套数],[核算出模数],[核算整啤净重],[核算啤数],[核算模具编号],[核算模具名称],[原料组净重KG]
FROM [塑胶采购订单明细] WITH(HOLDLOCK) WHERE [单号]=@number ORDER BY [ID]", new { number }, tx)).AsList();
        if (saved.Count == 0 || saved.Any(x => x.原料组号 is not > 0 || x.原料组主行 is null || x.原料组成员数 is not > 0 ||
            string.IsNullOrWhiteSpace(x.物料编号) || string.IsNullOrWhiteSpace(x.原料编号) || string.IsNullOrWhiteSpace(x.核算模具编号) ||
            (version == 2 ? x.核算套数 is not > 0 : x.核算出模数 is not > 0) || x.核算整啤净重 is not > 0 || x.核算啤数 is null or < 0 ||
            x.核算啤数 != decimal.Truncate(x.核算啤数.Value) || x.原料组净重KG is null or < 0 ||
            x.原料组净重KG > MaximumKg || x.数量 < 0 || (version == 2 && x.套数 is not null && x.套数 != x.核算套数)))
            throw new InvalidOperationException(InvalidMoldingSnapshot);
        var actualParts = await ReadSavedCoreAsync(c, tx, number);
        var actualByLine = actualParts.GroupBy(x => x.采购明细ID).ToDictionary(x => x.Key, x => x.ToList());
        var plans = new List<MoldingGroup>();
        foreach (var savedGroup in saved.GroupBy(x => x.原料组号!.Value).OrderBy(x => x.Key))
        {
            var groupRows = savedGroup.ToList();
            var owners = groupRows.Where(x => x.原料组主行 == true).ToList();
            if (owners.Count != 1) throw new InvalidOperationException(InvalidMoldingSnapshot);
            var owner = owners[0];
            if (version == 3 && groupRows.GroupBy(x => x.物料编号, StringComparer.OrdinalIgnoreCase).Any(g => g.Select(x => x.核算出模数).Distinct().Count() != 1))
                throw new InvalidOperationException(InvalidMoldingSnapshot);
            var key = MoldingGroupKey(owner.核算模具编号!, owner.原料编号!, owner.色粉号, owner.颜色);
            if (groupRows.Any(x => x.原料组成员数 != groupRows.Count ||
                MoldingGroupKey(x.核算模具编号!, x.原料编号!, x.色粉号, x.颜色) != key ||
                x.核算整啤净重 != owner.核算整啤净重 || x.核算啤数 != owner.核算啤数 || x.核算模具名称 != owner.核算模具名称 || x.原料组净重KG != owner.原料组净重KG ||
                (version == 3 && (x.啤货订单数量 != owner.啤货订单数量 || x.啤货总用量 != owner.啤货总用量 || x.啤货颜色数 != owner.啤货颜色数 || x.啤货公式说明 != owner.啤货公式说明 || x.啤货用量文本 != owner.啤货用量文本)) ||
                (x.原料组主行 == true ? x.原料用量KG != x.原料组净重KG : x.原料用量KG is not null)))
                throw new InvalidOperationException(InvalidMoldingSnapshot);
            var members = groupRows.Select(x => new MoldingMember(new()
            {
                物料编号 = x.物料编号, 数量 = x.数量, 套数 = x.套数,
                生产单号 = x.生产单号, 款号 = x.款号, 色粉号 = x.色粉号, 颜色 = x.颜色
            }, new(), new() { 核算套数 = x.核算套数, 核算出模数 = x.核算出模数, 原料组号 = x.原料组号 })).OrderBy(x => MoldingMemberKey(x.Input), StringComparer.Ordinal).ToList();
            var ownerInput = new PlasticRawPreviewLineRequest
            {
                物料编号 = owner.物料编号, 生产单号 = owner.生产单号, 款号 = owner.款号, 色粉号 = owner.色粉号, 颜色 = owner.颜色,
                数量 = owner.数量, 套数 = owner.套数
            };
            if (MoldingMemberKey(members[0].Input) != MoldingMemberKey(ownerInput))
                throw new InvalidOperationException(InvalidMoldingSnapshot);
            var shots = MoldingShots(members.Select(x => (x.Input.物料编号, x.Input.数量, (version == 2 ? x.Output.核算套数 : x.Output.核算出模数)!.Value)));
            if (shots != owner.核算啤数 || shots > MaximumKg * 1000m / owner.核算整啤净重!.Value ||
                !actualByLine.TryGetValue(owner.ID, out var ownerParts) || ownerParts.Count == 0 ||
                groupRows.Where(x => x.ID != owner.ID).Any(x => actualByLine.ContainsKey(x.ID)) ||
                ownerParts.Sum(x => x.用量KG) != owner.原料组净重KG || ownerParts.Select(x => x.原料ID).Distinct().Count() != ownerParts.Count)
                throw new InvalidOperationException(InvalidMoldingSnapshot);
            // 只用冻结比例重建理论分摊，不读现有配方；主档后改不应重解释原采购单。
            var parts = ownerParts.OrderBy(x => x.原料编号, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.原料ID).Select(x => new PlasticRawConsumptionSnapshot
            {
                采购明细ID = x.采购明细ID, 原料ID = x.原料ID, 原料编号 = x.原料编号, 原料名称 = x.原料名称,
                比例 = x.比例, 库存单位 = x.库存单位, 每库存单位KG = x.每库存单位KG
            }).ToList();
            AllocateMoldingRecipe(parts, decimal.Round(owner.核算整啤净重.Value * shots / 1000m, 4, MidpointRounding.AwayFromZero));
            plans.Add(new(key, members, parts));
        }
        if (plans.Select(x => x.Key).Distinct(StringComparer.Ordinal).Count() != plans.Count)
            throw new InvalidOperationException(InvalidMoldingSnapshot);
        // 同一真实原料在各组必须使用相同身份及库存换算，不能靠别名或第二套单位重复扣减。
        if (actualParts.GroupBy(x => x.原料ID).Any(x => x.Select(p => (p.原料编号, p.库存单位, p.每库存单位KG)).Distinct().Count() != 1))
            throw new InvalidOperationException(InvalidMoldingSnapshot);
        RoundMoldingRawTotals(plans);
        var expected = plans.SelectMany(x => x.Parts).ToDictionary(x => (x.采购明细ID, x.原料ID));
        if (expected.Count != actualParts.Count || actualParts.Any(x => !expected.TryGetValue((x.采购明细ID, x.原料ID), out var part) ||
            part.用量KG != x.用量KG || part.库存数量 != x.库存数量 || part.总比例 != x.总比例))
            throw new InvalidOperationException(InvalidMoldingSnapshot);
    }
}
