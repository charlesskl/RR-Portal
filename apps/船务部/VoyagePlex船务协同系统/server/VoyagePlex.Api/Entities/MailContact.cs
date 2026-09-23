namespace VoyagePlex.Api.Entities;

public sealed class MailContact
{
    public long Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string ContactType { get; set; } = "Unknown";
    public string DefaultCategory { get; set; } = "Unclassified";
    public bool IsConfirmed { get; set; }
    public int MessageCount { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
