namespace SprayPlan.Api.Services.Import;

/// <summary>
/// 工序「小类」→「大类」关键词启发式。判定不了返回 null（交预览人工）。
/// 顺序敏感：先 UV、再移印、再自动、最后手喷类。大类取值对齐 CraftTypes.All。
/// </summary>
public static class CraftClassifier
{
    public static string? Classify(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim();

        // 优先级 1: UV 及平板打印相关
        if (s.Contains("UV") || s.Contains("平板机打印") || s.Contains("打印")) return "UV";

        // 优先级 2: 移印
        if (s.Contains("移印")) return "移印";

        // 优先级 3: 自动喷（自动机、机喷、炒货机）
        if (s.Contains("自动") || s.Contains("机喷") || s.Contains("炒货机")) return "自动喷";

        // 优先级 4: 手喷及其各类别名
        if (s.Contains("手喷") || s.Contains("洗油") || s.Contains("补油") || s.Contains("PP水")
            || s.Contains("画油") || s.Contains("散枪") || s.Contains("喷油")) return "手喷";

        // 无法判定，交人工
        return null;
    }
}
