namespace VoyagePlex.Api.Entities;

public sealed class ImportEmailItem
{
    public long Id { get; set; }
    public long ImportBatchId { get; set; }
    public ImportBatch? ImportBatch { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = string.Empty;
    public string MailboxKey { get; set; } = string.Empty;
    public string MailSubject { get; set; } = string.Empty;
    public string MailSender { get; set; } = string.Empty;
    public string MailReceivedAt { get; set; } = string.Empty;
    public string MailReceivedDate { get; set; } = string.Empty;
    public string WorkCategory { get; set; } = "Unclassified";
    public string ClassificationSource { get; set; } = "Automatic";
    public int ClassificationConfidence { get; set; }
    public bool NeedsClassificationReview { get; set; } = true;
    public string HandlingStatus { get; set; } = "Pending";
    public string WorkNote { get; set; } = string.Empty;
    public DateTime? ReviewedAt { get; set; }
    public string Status { get; set; } = "Pending";
    public long? DuplicateOfItemId { get; set; }
    public string ResultJson { get; set; } = "{}";
    public string Error { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
