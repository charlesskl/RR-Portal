namespace VoyagePlex.Api.Entities;

public sealed class MailSyncState
{
    public int Id { get; set; } = 1;
    public string Address { get; set; } = string.Empty;
    public long UidValidity { get; set; }
    public long LastUid { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public string LastError { get; set; } = string.Empty;
}
