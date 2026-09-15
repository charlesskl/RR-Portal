using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace VoyagePlex.Api.Services;

public static class UtcDateTime
{
    public static DateTime Normalize(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}

/// <summary>
/// 宽松的 DateTime 反序列化：同时接受 ISO 8601（2026-09-11T00:31:18）和旧系统导出的
/// 空格分隔格式（2026-09-11 00:31:18.690457）。System.Text.Json 默认只认 ISO 8601，
/// seed/product-infos.json 的空格格式曾导致启动 seed 时 JsonException 崩溃（容器 unhealthy）。
/// </summary>
public sealed class LenientDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var raw = reader.GetString();
        if (DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
        {
            return value;
        }
        throw new JsonException($"Unsupported DateTime format: {raw}");
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
        => writer.WriteStringValue(UtcDateTime.Normalize(value));
}

