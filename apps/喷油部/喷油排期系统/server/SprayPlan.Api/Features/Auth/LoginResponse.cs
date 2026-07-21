namespace SprayPlan.Api.Features.Auth;

// 登录出参：只返回必要信息，不含 passwordHash（与现有 route 一致）
public record LoginResponse(int Id, string Username, string DisplayName, string Role);
