namespace IndoShipping.Domain.Entities;

public class Schedule
{
    public int Id { get; set; }
    public string? WeekLabel { get; set; }
    public DateTime? UploadDate { get; set; }
    public string? RawRows { get; set; }
    public string? DiffFromPrev { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
