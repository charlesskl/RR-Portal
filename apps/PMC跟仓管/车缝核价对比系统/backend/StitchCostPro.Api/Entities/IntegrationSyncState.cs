namespace StitchCostPro.Api.Entities;

/// <summary>总部集成同步游标：每个来源 × 资源一行，记录上次成功同步位置（只有整页落库成功才推进）。</summary>
public class IntegrationSyncState
{
    public string Source { get; set; } = null!;              // 来源标识（hq=总部加工厂系统）
    public string ResourceType { get; set; } = null!;        // factories / orders
    public string? LastCursorUpdatedAt { get; set; }         // 上一页 next_updated_after（原样保存、原样回传）
    public string? LastCursorId { get; set; }                // 上一页 next_cursor_id（必须与 updated_at 一起回传）
    public DateTime? LastSuccessAt { get; set; }             // 最近一次整轮成功时间(UTC)
    public string? LastError { get; set; }                   // 最近一次失败信息
    public DateTime UpdatedAt { get; set; }                  // 本行最后更新时间(UTC)
}
