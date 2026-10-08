using Dapper;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuthServiceDbTests(DbFixture fx)
{
    private (AuthService svc, ISqlConnectionFactory f) Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
            ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB",
            ["Erp:Login:MaxFailures"]="5", ["Erp:Login:LockMinutes"]="15",
            ["Erp:Jwt:Issuer"]="ErpApi", ["Erp:Jwt:Audience"]="ErpClient", ["Erp:Jwt:ExpireMinutes"]="480"
        }).Build();
        var f = new SqlConnectionFactory(cfg);
        var hasher = new BcryptPasswordHasher();
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [sysfileuser] WHERE [用户]='p0user'");
            c.Execute("INSERT INTO [sysfileuser]([用户],[密码],[登录失败次数]) VALUES('p0user',@h,0)",
                new { h = hasher.Hash("Right#123") });
        }
        return (new AuthService(f, hasher, new JwtTokenService(cfg), cfg), f);
    }

    [SkippableFact]
    public async Task Correct_password_succeeds()
    {
        var (svc, _) = Make();
        var r = await svc.LoginAsync("p0user", "Right#123");
        Assert.True(r.成功);
        Assert.NotNull(r.令牌);
    }

    [SkippableFact]
    public async Task Backdoor_password_fails()
    {
        var (svc, _) = Make();
        var r = await svc.LoginAsync("p0user", "zsbqr.com!#("); // 原万能密码后门必须失败
        Assert.False(r.成功);
    }

    [SkippableFact]
    public async Task Five_failures_lock_account()
    {
        var (svc, f) = Make();
        for (int i = 0; i < 5; i++) await svc.LoginAsync("p0user", "wrong");
        var r = await svc.LoginAsync("p0user", "Right#123"); // 即便密码对，也因锁定被拒
        Assert.False(r.成功);
        Assert.Contains("锁定", r.消息);
        using var c = fx.Open();
        Assert.Null(c.ExecuteScalar<string>("SELECT [错密1] FROM [sysfileuser] WHERE [用户]='p0user'")); // 不存明文错密
    }
}
