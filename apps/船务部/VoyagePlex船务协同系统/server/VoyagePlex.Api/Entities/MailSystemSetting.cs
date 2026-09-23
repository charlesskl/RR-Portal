namespace VoyagePlex.Api.Entities;

public sealed class MailSystemSetting
{
    public int Id { get; set; } = 1;
    public bool SyncEnabled { get; set; } = true;
    public int SyncIntervalMinutes { get; set; } = 5;
    public int RetentionDays { get; set; } = 180;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
