namespace VoyagePlex.Api.Entities;

public sealed class InventoryWriteback : ICompanyEntity
{
    public long Id { get; set; }
    public string Company { get; set; } = "Xingxin";
    public long TaskId { get; set; }
    public string OperationId { get; set; } = "";
    public string State { get; set; } = "Preparing";
    public string SnapshotJson { get; set; } = "{}";
    public string ResultJson { get; set; } = "{}";
    public long ActorId { get; set; }
    public string ActorName { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public sealed class InventoryFileClaim
{
    public string Filename { get; set; } = "";
    public string OperationId { get; set; } = "";
}
public sealed class TaskEditAudit : ICompanyEntity
{
    public long Id { get; set; }
    public string Company { get; set; } = "Xingxin";
    public long TaskId { get; set; }
    public long OwnerId { get; set; }
    public long ActorId { get; set; }
    public string ActorName { get; set; } = "";
    public string Action { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
