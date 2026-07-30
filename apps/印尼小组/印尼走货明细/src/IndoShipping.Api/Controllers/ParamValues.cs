using System.Text.Json;

namespace IndoShipping.Api.Controllers;

internal static class ParamValues
{
    // [FromBody] Dictionary<string, object?> 的值实际是 JsonElement。
    // SQL Server 时代 Dapper 把它们当文本传、由数据库隐式转换侥幸工作；
    // Npgsql 类型严格（text 不会隐式转 int/bool），必须归一化为 CLR 原语。
    public static object? Normalize(object? value)
    {
        if (value is not JsonElement je) return value;
        return je.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => je.GetString(),
            JsonValueKind.Number => je.TryGetInt64(out var l)
                ? l
                : je.TryGetDecimal(out var m) ? m : je.GetDouble(),
            _ => je.GetRawText(),
        };
    }
}
