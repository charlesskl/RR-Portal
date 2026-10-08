namespace ErpApi.Infrastructure.Security;

public sealed class BcryptPasswordHasher : IPasswordHasher
{
    // workFactor 10 => 哈希串长 60，正好适配 sysfileuser.密码 nvarchar(60)
    public string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, workFactor: 10);

    public bool Verify(string password, string hash)
    {
        if (string.IsNullOrEmpty(hash)) return false;
        try { return BCrypt.Net.BCrypt.Verify(password, hash); }
        catch (BCrypt.Net.SaltParseException) { return false; }
    }
}
