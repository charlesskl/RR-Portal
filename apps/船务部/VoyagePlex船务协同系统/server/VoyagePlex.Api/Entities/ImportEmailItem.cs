namespace VoyagePlex.Api.Entities;

public sealed class ImportEmailItem
{
    public long Id { get; set; }
    public long ImportBatchId { get; set; }
    public ImportBatch? ImportBatch { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = string.Empty;
    public string Status { get; set; } = "Pending";
    public long? DuplicateOfItemId { get; set; }
    public string ResultJson { get; set; } = "{}";
    public string Error { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
