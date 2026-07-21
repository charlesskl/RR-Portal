namespace SprayPlan.Api.Features.Basic;

// 入参
public record CreateMachineRequest(string? MachineNo, int? LineId, string? MachineType, bool? IsUV);
public record UpdateMachineRequest(string? MachineNo, string? MachineType, bool? IsUV, bool? IsActive, int? LineId, string? EquipmentKind);
// 批量录入：选一条拉，Text 里一串机台号（空格/逗号/中文逗号/换行均可分隔）
public record BatchCreateMachineRequest(int? LineId, string? Text);

// 出参（字段严格对齐现有 /api/machines 的 select / include）
public record LineBrief(string Name, string Workshop);
public record MachineWithLine(int Id, string MachineNo, int LineId, string MachineType, bool IsUV, bool IsActive, string EquipmentKind, LineBrief? Line);
public record MachineCreated(int Id, string MachineNo, int LineId, bool IsUV);
public record MachineUpdated(int Id, string MachineNo, string MachineType, bool IsUV, bool IsActive, string EquipmentKind);
// 批量结果：新建几台、各是哪些号、哪些因已存在被跳过
public record BatchCreateResult(int Created, List<string> CreatedNos, List<string> SkippedExisting);
