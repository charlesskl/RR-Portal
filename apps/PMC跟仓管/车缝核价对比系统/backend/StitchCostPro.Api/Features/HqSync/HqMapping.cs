using System.Globalization;

namespace StitchCostPro.Api.Features.HqSync;

/// <summary>总部字段 → 本地字段 的映射规则（依据 API 接口规范 V1.0）。</summary>
public static class HqMapping
{
    /// <summary>
    /// 订单状态映射。is_deleted=true 优先于 status，一律落为「已作废」（规范第 7 节）。
    /// 返回 null 表示未知状态：调用方保留本地原值并记 warning。
    /// </summary>
    public static string? MapOrderStatus(bool isDeleted, string? status)
    {
        if (isDeleted) return "已作废";
        return status switch
        {
            "placed" => "已下单",
            "producing" => "生产中",
            "delivered" => "已交货",
            "cancelled" => "已取消",
            "returned" => "已退回",
            "voided" => "已作废",
            _ => null,
        };
    }

    /// <summary>解析 RFC 3339 时间戳为 UTC DateTime（存 source_updated_at 快照）。</summary>
    public static DateTime? ParseUtc(string? value)
        => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto)
            ? dto.UtcDateTime : null;

    /// <summary>解析 YYYY-MM-DD 日期。</summary>
    public static DateOnly? ParseDate(string? value)
        => DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    /// <summary>总部月产能(number) → 本地月产能(文字)。</summary>
    public static string? CapacityToString(decimal? value)
        => value?.ToString(CultureInfo.InvariantCulture);
}
