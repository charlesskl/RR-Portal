namespace SprayPlan.Api.Features.Basic;

// 工序对照表接口出入参 DTO
public record CraftAliasDto(int Id, string Alias, string Category);

// 新建入参：alias 小类名，category 大类（4 选 1）
public record CreateCraftAliasRequest(string? Alias, string? Category);

// 编辑入参：两字段均可选，只改传了的
public record UpdateCraftAliasRequest(string? Alias, string? Category);
