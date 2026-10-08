namespace ErpApi.Features.SystemConfig;
public sealed class SysConfigDto
{ public string 键 { get; set; } = ""; public string? 值 { get; set; } public bool 是否加密 { get; set; } public string? 备注 { get; set; } }
public sealed class SysConfigRow
{ public string? 键 { get; set; } public string? 值 { get; set; } public bool 是否加密 { get; set; } public string? 备注 { get; set; } }
