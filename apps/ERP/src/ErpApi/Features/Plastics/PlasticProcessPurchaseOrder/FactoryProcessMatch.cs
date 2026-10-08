namespace ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;

// 加工内容 与 加工厂类别 的一致性判断(与前端 web/src/utils/factoryProcessMatch.ts 同规则)。
// 类别去「加工」后缀后与加工内容做包含匹配,另配同义关键字(印刷=印/喷 等)。
// 厂无类别=不限制;行无加工内容=不匹配。
public static class FactoryProcessMatch
{
    private static readonly Dictionary<string, string[]> Alias = new()
    {
        ["印刷"] = new[] { "印", "喷" },
        ["电镀"] = new[] { "电镀" },
        ["啤机"] = new[] { "啤" },
        ["车发"] = new[] { "车", "缝" },
        ["植绒"] = new[] { "植绒" },
        ["镭雕"] = new[] { "镭" },
        ["装配"] = new[] { "装配" },
    };

    public static bool Matches(string? 类别, string? 加工内容)
    {
        var cat = (类别 ?? "").Trim();
        var content = (加工内容 ?? "").Trim();
        if (cat.Length == 0) return true;
        if (content.Length == 0) return false;
        var key = cat.EndsWith("加工", StringComparison.Ordinal) ? cat[..^2] : cat;
        var kws = Alias.TryGetValue(key, out var a) ? a : new[] { key };
        return kws.Any(content.Contains);
    }
}
