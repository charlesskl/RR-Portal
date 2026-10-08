using System.Text.Json;
namespace ErpApi.Features.MasterData;

// Excel 导入统一返回:新增/跳过(编号已存在,无明细)/失败(含明细)
public sealed class ImportFailure
{
    public int 行号 { get; set; }
    public string? 物料编号 { get; set; }
    public string 原因 { get; set; } = "";
}

public sealed class ImportResult
{
    public int 新增 { get; set; }
    public int 跳过 { get; set; }
    public int 失败 { get; set; }
    public List<ImportFailure> 失败明细 { get; set; } = new();
}

// Excel 导入共用的行级纯校验辅助:Trim/空串→null、列宽检查、宽松数字解析(前端已校验,这里兜底)。
internal static class MasterImportHelper
{
    // 统一 Trim,空串存 null
    public static string? Clean(string? s)
        => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // nvarchar 列宽兜底,超长返回错误原因
    public static string? LengthError(string? value, string column, int max)
        => value is not null && value.Length > max ? $"{column}超过{max}字" : null;

    // 单价/最低库存等数字列:接受 JSON 数字或可解析字符串,其余按失败行处理
    public static (decimal? Value, string? Error) ParseDecimal(object? raw, string column)
    {
        switch (raw)
        {
            case null: return (null, null);
            case decimal d: return (d, null);
            case JsonElement je:
                if (je.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return (null, null);
                if (je.ValueKind == JsonValueKind.Number && je.TryGetDecimal(out var n)) return (n, null);
                if (je.ValueKind == JsonValueKind.String)
                {
                    var s = je.GetString();
                    if (string.IsNullOrWhiteSpace(s)) return (null, null);
                    if (decimal.TryParse(s.Trim(), out var m)) return (m, null);
                }
                return (null, $"{column}不是数字");
            default:
                var text = raw.ToString();
                if (string.IsNullOrWhiteSpace(text)) return (null, null);
                return decimal.TryParse(text.Trim(), out var v) ? (v, null) : ((decimal?)null, $"{column}不是数字");
        }
    }
}
