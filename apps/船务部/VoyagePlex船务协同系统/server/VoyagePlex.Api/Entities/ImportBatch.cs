namespace VoyagePlex.Api.Entities;

public sealed class ImportBatch
{
    public long Id { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty; // 批次显示名称，兼容骨架字段
    public string Status { get; set; } = "Pending";
    public int TotalCount { get; set; }
    public int ParsedCount { get; set; }
    public int FailedCount { get; set; }
    public string ParserVersion { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ImportEmailItem> EmailItems { get; set; } = [];
}
