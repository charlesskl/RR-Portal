namespace ErpApi.Features.Plastics;

// 旧版ERP二次加工(喷油/电镀/植发/植绒)规则,纯函数。
// 类别后缀: 白胶件→电镀→印喷 = BD;白胶件→印喷→植绒 = AF;白胶件→印喷→植发 = AH。
// 顺序容错: 电镀与印喷组合无论先后都归 BD(说明书:先喷油后电镀可默认为是先电镀后喷油)。
// 加工字母绑定工序本身而非录入次序:
//   BD 类: 电镀=B(第一次), 印喷=D(第二次);AF 类: 印喷=A, 植绒=F;AH 类: 印喷=A, 植发=H。
public static class SecondProcessCategory
{
    private const string 电镀 = "电镀";
    private const string 印喷 = "印喷";
    private const string 植绒 = "植绒";
    private const string 植发 = "植发";

    // 把自由文本的加工内容归一到四种工序之一;"喷油"/"移印"视同"印喷"(含「喷」或「印」即归印喷)。无法识别返回 null。
    private static string? 归一(string? 加工内容)
    {
        if (string.IsNullOrWhiteSpace(加工内容)) return null;
        var s = 加工内容.Trim();
        if (s.Contains(电镀)) return 电镀;
        if (s.Contains(植绒)) return 植绒;
        if (s.Contains(植发)) return 植发;
        if (s.Contains('喷') || s.Contains('印')) return 印喷;
        return null;
    }

    // 按 加工内容(第一次) + 二次加工内容(第二次) 推导类别后缀;组合不在三种之内返回 null。
    public static string? 推导后缀(string? 加工内容, string? 二次加工内容)
    {
        var a = 归一(加工内容);
        var b = 归一(二次加工内容);
        if (a is null || b is null || a == b) return null;
        var pair = new HashSet<string> { a, b };
        if (pair.Contains(电镀) && pair.Contains(印喷)) return "BD";
        if (pair.Contains(印喷) && pair.Contains(植绒)) return "AF";
        if (pair.Contains(印喷) && pair.Contains(植发)) return "AH";
        return null;
    }

    // 某类别下某工序对应的加工字母;类别或工序无法识别返回 null。
    public static string? 加工字母(string? 类别后缀, string? 加工内容)
    {
        var p = 归一(加工内容);
        if (p is null) return null;
        return 类别后缀 switch
        {
            "BD" => p == 电镀 ? "B" : p == 印喷 ? "D" : null,
            "AF" => p == 印喷 ? "A" : p == 植绒 ? "F" : null,
            "AH" => p == 印喷 ? "A" : p == 植发 ? "H" : null,
            _ => null,
        };
    }
}
