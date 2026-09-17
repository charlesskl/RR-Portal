namespace QcInspection.Api.Entities;

public sealed class ZuruScheduleRecord
{
    public long Id { get; set; }
    public string BusinessKey { get; set; } = string.Empty;
    public string Customer { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
    public string PoNumber { get; set; } = string.Empty;
    public string CustomerPo { get; set; } = string.Empty;
    public string ItemNumber { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public decimal? Quantity { get; set; }
    public decimal? Cartons { get; set; }
    public DateTime? PlannedShipDate { get; set; }
    public DateTime? PlannedInspectionDate { get; set; }
    public DateTime? ThirdPartyInspectionDate { get; set; }
    public string InspectionResult { get; set; } = string.Empty;
    public string SourceFile { get; set; } = string.Empty;
    public string SourceSheet { get; set; } = string.Empty;
    public int SourceRow { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class ScheduleImportBatch
{
    public long Id { get; set; }
    public string Source { get; set; } = "ZURU";
    public string FileName { get; set; } = string.Empty;
    public string UploadedBy { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ConfirmedAt { get; set; }
    public string Status { get; set; } = "待确认";
    public int ParsedCount { get; set; }
    public int NewCount { get; set; }
    public int ChangedCount { get; set; }
    public int UnchangedCount { get; set; }
    public int CompletedSkippedCount { get; set; }
    public int InvalidSkippedCount { get; set; }
    public int PendingReviewCount { get; set; }
    public int ActualNewCount { get; set; }
    public int ActualChangedCount { get; set; }
    public string ImportRange { get; set; } = string.Empty;
    public string PreviewJson { get; set; } = "[]";
}
