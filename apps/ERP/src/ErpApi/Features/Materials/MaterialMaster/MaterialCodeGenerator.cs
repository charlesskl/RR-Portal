namespace ErpApi.Features.Materials.MaterialMaster;

// 物料编号生成：类别前缀 + 递增数字序号（取现有同前缀编号中"前缀+纯数字"的最大序号 +1）。
// 决策说明：旧说明书只要求"选中类别后编号自动生成"，未给编号规则；现有种子数据形如 MM001，
// 故采用 类别前缀+序号 方案，序号宽度跟随现有最大编号（至少 3 位）。详见工作日志。
public static class MaterialCodeGenerator
{
    public const string DefaultPrefix = "M";
    public const int MaxPrefixLength = 14; // 物料编号 nvarchar(20)，至少留 6 位序号

    // 前缀取值：类别主数据 编号 → 类别名 → 默认 "M"；超长截断
    public static string NormalizePrefix(string? 类别, string? 类别编号)
    {
        var p = !string.IsNullOrWhiteSpace(类别编号) ? 类别编号!.Trim()
              : !string.IsNullOrWhiteSpace(类别) ? 类别!.Trim()
              : DefaultPrefix;
        return p.Length > MaxPrefixLength ? p[..MaxPrefixLength] : p;
    }

    public static string Next(string prefix, IEnumerable<string?> existingCodes)
    {
        var max = 0;
        var width = 3;
        foreach (var raw in existingCodes)
        {
            if (string.IsNullOrEmpty(raw) || !raw.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
            var suffix = raw[prefix.Length..];
            if (suffix.Length == 0 || !suffix.All(char.IsDigit)) continue;
            if (!int.TryParse(suffix, out var n)) continue; // 超出 int 的序号跳过
            if (n > max) { max = n; width = Math.Max(3, suffix.Length); }
        }
        return prefix + (max + 1).ToString().PadLeft(width, '0');
    }
}
