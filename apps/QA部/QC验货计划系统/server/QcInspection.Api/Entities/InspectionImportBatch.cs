namespace QcInspection.Api.Entities;

public sealed class InspectionImportBatch
{
    public long Id { get; set; }
    public string Site { get; set; } = "";
    public string FileName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int Inserted { get; set; }
    public int Updated { get; set; }
    public int ResultChanged { get; set; }
    public int Unchanged { get; set; }
    public int PendingReviewCount { get; set; }
    public string ItemsJson { get; set; } = "[]";
    public string SeenRecordIdsJson { get; set; } = "[]";
    public string IssuesJson { get; set; } = "[]";
}
public sealed record InspectionImportItem(long RecordId, string Kind, string Summary, InspectionRecord Record, bool ResultChanged = false);
