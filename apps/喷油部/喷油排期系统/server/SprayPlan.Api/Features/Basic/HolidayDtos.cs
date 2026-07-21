namespace SprayPlan.Api.Features.Basic;

public record CreateHolidayRequest(string? Date, string? Type, string? Remark);
public record UpdateHolidayRequest(string? Date, string? Type, string? Remark);
public record HolidayDto(int Id, string Date, string Type, string? Remark);
