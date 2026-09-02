namespace StitchCostPro.Api.Entities;

/// <summary>总部集成同步日志：一轮同步每个资源写一行，用于对账与排障。</summary>
public class IntegrationSyncLog
{
    public int Id { get; set; }
    public DateTime StartedAt { get; set; }                  // 本资源同步开始时间(UTC)
    public DateTime? FinishedAt { get; set; }                // 结束时间(UTC)
    public string ResourceType { get; set; } = null!;        // factories / orders
    public int ReceivedCount { get; set; }                   // 总部返回条数
    public int CreatedCount { get; set; }                    // 本地新建条数
    public int UpdatedCount { get; set; }                    // 本地更新条数
    public int SkippedCount { get; set; }                    // 跳过条数（如货号不存在）
    public int FailedCount { get; set; }                     // 失败条数（如加工厂未同步）
    public string Status { get; set; } = "success";          // success / failed
    public string? ErrorMessage { get; set; }
}
