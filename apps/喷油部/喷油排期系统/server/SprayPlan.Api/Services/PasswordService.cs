namespace SprayPlan.Api.Services;

// 密码工具：对应现有 lib/auth.ts 的 bcrypt 校验/哈希。
// bcrypt hash 格式通用，与现有 Node 端写入的 passwordHash 互通。
public static class PasswordService
{
    // 校验明文与哈希是否匹配（对应 bcrypt.compare）
    public static bool Verify(string plain, string hash) =>
        BCrypt.Net.BCrypt.Verify(plain, hash);

    // 生成哈希，salt rounds = 10（与现有 seed/auth 保持一致）
    public static string Hash(string plain) =>
        BCrypt.Net.BCrypt.HashPassword(plain, 10);
}
