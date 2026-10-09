namespace VoyagePlex.Api.Entities;

public sealed class AppUser
{
    public long Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string CompanyAccess { get; set; } = "Xingxin";
    public string MailboxAddress { get; set; } = "";
    public string MailboxHost { get; set; } = "imap.exmail.qq.com";
    public string MailboxFolder { get; set; } = "INBOX";
    public string MailboxSecretProtected { get; set; } = "";
    public string MailboxTestStatus { get; set; } = "Unknown";
    public DateTime? MailboxTestedAt { get; set; }
    public string Role { get; set; } = "shipping";
    public string PasswordHash { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
    public List<UserSession> Sessions { get; set; } = [];
}
