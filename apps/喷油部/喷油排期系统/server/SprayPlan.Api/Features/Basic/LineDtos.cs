namespace SprayPlan.Api.Features.Basic;

// 入参（末尾 DailyCapacityLimit：每天产能上限，单位件，可空——不传则新建按0、更新不动）
public record CreateLineRequest(string? Name, string? Workshop, string? LeaderName, string? CraftType, int? DailyCapacityLimit);
public record UpdateLineRequest(string? Name, string? Workshop, string? LeaderName, string? CraftType, bool? IsActive, int? DailyCapacityLimit);

// 出参（字段严格对齐现有 /api/lines 的 select；DailyCapacityLimit=该拉每天产能上限件数）
public record MachineBrief(int Id, string MachineNo, int LineId, string MachineType, bool IsUV, bool IsActive);
public record LineWithMachines(int Id, string Name, string Workshop, string? LeaderName, string CraftType, bool IsActive, int DailyCapacityLimit, List<MachineBrief> Machines);
public record LineCreated(int Id, string Name, string Workshop, string CraftType, int DailyCapacityLimit);
public record LineUpdated(int Id, string Name, string Workshop, string CraftType, bool IsActive, int DailyCapacityLimit);

// 工艺类型合法值（手喷 / 移印 / 自动喷 / UV）
public static class CraftTypes
{
    public static readonly string[] All = ["手喷", "移印", "自动喷", "UV"];
    public static bool IsValid(string? v) => v is not null && All.Contains(v);
}

// 软删返回（拉别/机台共用）
public record IdActive(int Id, bool IsActive);
