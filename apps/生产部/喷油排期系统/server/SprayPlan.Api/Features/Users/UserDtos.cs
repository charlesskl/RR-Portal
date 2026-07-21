namespace SprayPlan.Api.Features.Users;

// 新建用户入参（对应现有 POST /api/users body）
public record CreateUserRequest(string Username, string Password, string DisplayName, string Role);

// 修改用户入参：所有字段可选，null 表示"不改"（对应现有 PATCH 的 undefined 语义）
public record UpdateUserRequest(string? DisplayName, string? Role, bool? IsActive, string? NewPassword);

// 列表项（含 createdAt/lastLoginAt，对应现有 GET 列表字段）
public record UserListItem(int Id, string Username, string DisplayName, string Role,
    bool IsActive, DateTime CreatedAt, DateTime? LastLoginAt);

// 单个用户（不含 createdAt/lastLoginAt，对应现有创建/读单/改 的返回字段）
public record UserItem(int Id, string Username, string DisplayName, string Role, bool IsActive);
