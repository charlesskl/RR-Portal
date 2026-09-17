namespace QcInspection.Api.Entities;

public sealed class WorkshopMapping
{
    public long Id { get; set; }
    public string Workshop { get; set; } = string.Empty;
    public string Supervisor { get; set; } = string.Empty;
}
