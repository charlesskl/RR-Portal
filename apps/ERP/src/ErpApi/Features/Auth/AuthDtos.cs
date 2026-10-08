namespace ErpApi.Features.Auth;
public sealed record LoginRequest(string 用户, string 密码);
public sealed record LoginResult(bool 成功, string? 令牌, string? 消息);
public sealed record ChangePasswordRequest(string 原密码, string 新密码);
public sealed record ChangePasswordResult(bool 成功, string? 消息);
public sealed record HeartbeatRequest(bool 活动);
