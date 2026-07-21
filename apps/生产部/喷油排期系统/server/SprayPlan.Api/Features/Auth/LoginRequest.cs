namespace SprayPlan.Api.Features.Auth;

// 登录入参，对应现有 login route 的 body { username, password }
public record LoginRequest(string Username, string Password);
