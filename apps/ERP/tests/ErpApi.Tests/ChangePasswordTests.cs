using Dapper;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

// 自助修改密码：输入校验为纯单元测试（校验在触库前返回，不依赖 ERP_TEST_DB）；
// bcrypt 比对与写回为 DB 集成测试（未设置 ERP_TEST_DB 自动跳过）。
public class ChangePasswordValidationTests
{
    private static AuthService Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB",
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "480"
        }).Build();
        return new AuthService(new SqlConnectionFactory(cfg), new BcryptPasswordHasher(), new JwtTokenService(cfg), cfg);
    }

    [Fact]
    public async Task Empty_old_password_rejected()
    {
        var r = await Make().ChangePasswordAsync("u", "", "NewPass#1");
        Assert.False(r.成功);
        Assert.Equal("请输入原密码", r.消息);
    }

    [Fact]
    public async Task Empty_new_password_rejected()
    {
        var r = await Make().ChangePasswordAsync("u", "OldPass#1", "");
        Assert.False(r.成功);
        Assert.Equal("请输入新密码", r.消息);
    }

    [Fact]
    public async Task Short_new_password_rejected()
    {
        var r = await Make().ChangePasswordAsync("u", "OldPass#1", "abc12");
        Assert.False(r.成功);
        Assert.Contains("至少 6 位", r.消息);
    }

    [Fact]
    public async Task Same_password_rejected()
    {
        var r = await Make().ChangePasswordAsync("u", "Same#123", "Same#123");
        Assert.False(r.成功);
        Assert.Equal("新密码不能与原密码相同", r.消息);
    }
}

[Collection("db")]
public class ChangePasswordDbTests(DbFixture fx)
{
    private (AuthService svc, BcryptPasswordHasher hasher) Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB",
            ["Erp:Login:MaxFailures"] = "5", ["Erp:Login:LockMinutes"] = "15",
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "480"
        }).Build();
        var hasher = new BcryptPasswordHasher();
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [sysfileuser] WHERE [用户]='p0cpuser'");
            c.Execute("INSERT INTO [sysfileuser]([用户],[密码],[登录失败次数]) VALUES('p0cpuser',@h,0)",
                new { h = hasher.Hash("Old#12345") });
        }
        return (new AuthService(new SqlConnectionFactory(cfg), hasher, new JwtTokenService(cfg), cfg), hasher);
    }

    [SkippableFact]
    public async Task Wrong_old_password_fails()
    {
        var (svc, _) = Make();
        var r = await svc.ChangePasswordAsync("p0cpuser", "wrong-old", "New#12345");
        Assert.False(r.成功);
        Assert.Equal("原密码错误", r.消息);
    }

    [SkippableFact]
    public async Task Correct_old_password_changes_hash_and_allows_login()
    {
        var (svc, hasher) = Make();
        var r = await svc.ChangePasswordAsync("p0cpuser", "Old#12345", "New#12345");
        Assert.True(r.成功);

        using var c = fx.Open();
        var hash = c.ExecuteScalar<string>("SELECT [密码] FROM [sysfileuser] WHERE [用户]='p0cpuser'");
        Assert.False(hasher.Verify("Old#12345", hash));
        Assert.True(hasher.Verify("New#12345", hash));

        var login = await svc.LoginAsync("p0cpuser", "New#12345");
        Assert.True(login.成功);
    }

    [SkippableFact]
    public async Task Unknown_user_fails()
    {
        var (svc, _) = Make();
        var r = await svc.ChangePasswordAsync("no_such_user", "Old#12345", "New#12345");
        Assert.False(r.成功);
        Assert.Equal("用户不存在", r.消息);
    }
}
