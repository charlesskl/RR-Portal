using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
namespace ErpApi.Features.Admin;

// 账号管理(sysfileuser)。bcrypt 经 IPasswordHasher。禁用=锁定到期远期(复用 AuthService 登录门控)。绝不返回密码。
public sealed class AccountService(ISqlConnectionFactory factory, IPasswordHasher hasher)
{
    public async Task<IReadOnlyList<AccountRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<AccountRow>(@"
SELECT [用户],[登录状态],[上次登录],[日期],[登录失败次数],[锁定到期],[最后心跳时间],[最后活动时间],
    CASE WHEN [最后心跳时间] IS NULL OR DATEDIFF(MINUTE,[最后心跳时间],GETDATE()) > 3 THEN N'离线'
         WHEN [最后活动时间] IS NOT NULL AND DATEDIFF(MINUTE,[最后活动时间],GETDATE()) <= 10 THEN N'在线'
         ELSE N'忙线' END AS [在线状态]
FROM [sysfileuser] WHERE @kw IS NULL OR [用户] LIKE @kw ORDER BY [用户];", new { kw })).AsList();
        var now = DateTime.Now;
        foreach (var r in rows) r.已锁定 = r.锁定到期 is { } d && d > now;
        return rows;
    }

    public async Task RegisterAsync(string 用户名, string 初始密码, string operatorUser)
    {
        if (string.IsNullOrWhiteSpace(用户名)) throw new ArgumentException("用户名必填");
        if (string.IsNullOrEmpty(初始密码)) throw new ArgumentException("初始密码必填");
        using var c = factory.Create();
        await c.OpenAsync();
        var exists = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [sysfileuser] WHERE [用户]=@用户名", new { 用户名 });
        if (exists > 0) throw new InvalidOperationException("用户名已存在");
        await c.ExecuteAsync(@"
INSERT INTO [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@用户名,@密码,N'',0)",
            new { 用户名, 密码 = hasher.Hash(初始密码) });
    }

    public async Task<bool> ResetPasswordAsync(string 用户名, string 新密码)
    {
        if (string.IsNullOrEmpty(新密码)) throw new ArgumentException("新密码必填");
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [密码]=@密码 WHERE [用户]=@用户名",
            new { 用户名, 密码 = hasher.Hash(新密码) }) > 0;
    }

    public async Task<bool> LockAsync(string 用户名)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [锁定到期]=@d WHERE [用户]=@用户名",
            new { 用户名, d = new DateTime(2999, 12, 31) }) > 0;
    }

    public async Task<bool> UnlockAsync(string 用户名)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [锁定到期]=NULL,[登录失败次数]=0 WHERE [用户]=@用户名",
            new { 用户名 }) > 0;
    }

    public async Task<bool> DeleteAsync(string 用户名)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }, tx);
        var n = await c.ExecuteAsync("DELETE FROM [sysfileuser] WHERE [用户]=@用户名", new { 用户名 }, tx);
        tx.Commit();
        return n > 0;
    }
}
