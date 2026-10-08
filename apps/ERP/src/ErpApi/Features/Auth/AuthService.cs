using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
namespace ErpApi.Features.Auth;

public sealed class AuthService(
    ISqlConnectionFactory factory, IPasswordHasher hasher,
    IJwtTokenService jwt, IConfiguration config)
{
    public async Task<LoginResult> LoginAsync(string userName, string password)
    {
        int maxFail = int.TryParse(config["Erp:Login:MaxFailures"], out var mf) ? mf : 5;
        int lockMin = int.TryParse(config["Erp:Login:LockMinutes"], out var lm) ? lm : 15;

        using var c = factory.Create();
        await c.OpenAsync();
        var u = await c.QuerySingleOrDefaultAsync(
            "SELECT [用户],[密码],[登录失败次数],[锁定到期] FROM [sysfileuser] WHERE [用户]=@userName",
            new { userName });

        // 无此用户：返回与密码错误一致的模糊消息（不泄露用户是否存在）
        if (u is null) return new LoginResult(false, null, "用户名或密码错误");

        if (u.锁定到期 is DateTime until && until > DateTime.Now)
            return new LoginResult(false, null, $"账户已锁定，请于 {until:HH:mm} 后再试");

        // 唯一的校验路径：bcrypt 比对。没有任何万能密码/后门分支。
        bool ok = hasher.Verify(password, (string?)u.密码 ?? "");
        if (!ok)
        {
            int fails = (int)(u.登录失败次数 ?? 0) + 1;
            DateTime? lockUntil = fails >= maxFail ? DateTime.Now.AddMinutes(lockMin) : null;
            // 只存失败次数与锁定时间，绝不写入明文错误密码
            await c.ExecuteAsync(
                "UPDATE [sysfileuser] SET [登录失败次数]=@fails,[锁定到期]=@lockUntil WHERE [用户]=@userName",
                new { fails, lockUntil, userName });
            return new LoginResult(false, null, "用户名或密码错误");
        }

        // 成功：清零计数、记录登录信息
        await c.ExecuteAsync(@"UPDATE [sysfileuser]
            SET [登录失败次数]=0,[锁定到期]=NULL,[登录状态]=N'在线',[日期]=GETDATE()
            WHERE [用户]=@userName", new { userName });
        return new LoginResult(true, jwt.Issue((string)u.用户), null);
    }

    // 在线心跳:登录用户每 60s 打一次;active=true(10 分钟内有鼠标/键盘操作)同时刷 最后活动时间。
    // 状态判定在 AccountService.ListAsync:心跳空或断 >3min=离线,活动 >10min=忙线,否则在线。
    public async Task HeartbeatAsync(string userName, bool active)
    {
        using var c = factory.Create();
        await c.ExecuteAsync(@"UPDATE [sysfileuser]
            SET [最后心跳时间]=GETDATE(),[登录状态]=N'在线'" + (active ? ",[最后活动时间]=GETDATE()" : "") + @"
            WHERE [用户]=@userName", new { userName });
    }

    // 退出登录:立即置离线(清心跳),无需等心跳超时
    public async Task LogoutAsync(string userName)
    {
        using var c = factory.Create();
        await c.ExecuteAsync(
            "UPDATE [sysfileuser] SET [登录状态]=N'',[最后心跳时间]=NULL WHERE [用户]=@userName",
            new { userName });
    }

    // 用户自助修改密码：先校验输入（不触库），再 bcrypt 比对原密码，最后加盐哈希写回。
    public async Task<ChangePasswordResult> ChangePasswordAsync(string userName, string 原密码, string 新密码)
    {
        if (string.IsNullOrEmpty(原密码)) return new ChangePasswordResult(false, "请输入原密码");
        if (string.IsNullOrEmpty(新密码)) return new ChangePasswordResult(false, "请输入新密码");
        if (新密码.Length < 6) return new ChangePasswordResult(false, "新密码长度至少 6 位");
        if (新密码 == 原密码) return new ChangePasswordResult(false, "新密码不能与原密码相同");

        using var c = factory.Create();
        await c.OpenAsync();
        var hash = await c.QuerySingleOrDefaultAsync<string>(
            "SELECT [密码] FROM [sysfileuser] WHERE [用户]=@userName", new { userName });
        if (hash is null) return new ChangePasswordResult(false, "用户不存在");
        if (!hasher.Verify(原密码, hash)) return new ChangePasswordResult(false, "原密码错误");

        await c.ExecuteAsync("UPDATE [sysfileuser] SET [密码]=@密码 WHERE [用户]=@userName",
            new { userName, 密码 = hasher.Hash(新密码) });
        return new ChangePasswordResult(true, null);
    }
}
