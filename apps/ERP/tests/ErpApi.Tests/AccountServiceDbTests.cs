using Dapper;
using ErpApi.Features.Admin;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AccountServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private static AccountService Svc() => new(Factory(), new BcryptPasswordHasher());

    [SkippableFact]
    public async Task Account_lifecycle_register_reset_lock_unlock_delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var svc = Svc();
        var hasher = new BcryptPasswordHasher();
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'ACCT_T1'");
            c.Execute("DELETE FROM [sysfileuser] WHERE [用户]=N'ACCT_T1'");
        }
        Clean();
        try
        {
            // 注册
            await svc.RegisterAsync("ACCT_T1", "pwd123", "admin");
            var list = await svc.ListAsync("ACCT_T1");
            Assert.Contains(list, r => r.用户 == "ACCT_T1");

            // 库内密码为 bcrypt 哈希,可校验明文
            var pwd = c.ExecuteScalar<string>("SELECT [密码] FROM [sysfileuser] WHERE [用户]=N'ACCT_T1'");
            Assert.True(hasher.Verify("pwd123", pwd!));

            // 重复注册同名 → 抛 InvalidOperationException
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.RegisterAsync("ACCT_T1", "whatever", "admin"));

            // 重置密码
            Assert.True(await svc.ResetPasswordAsync("ACCT_T1", "new456"));
            var pwd2 = c.ExecuteScalar<string>("SELECT [密码] FROM [sysfileuser] WHERE [用户]=N'ACCT_T1'");
            Assert.True(hasher.Verify("new456", pwd2!));
            Assert.False(hasher.Verify("pwd123", pwd2!));

            // 锁定 → 已锁定 true(锁定到期>now)
            Assert.True(await svc.LockAsync("ACCT_T1"));
            var locked = (await svc.ListAsync("ACCT_T1")).Single(r => r.用户 == "ACCT_T1");
            Assert.True(locked.已锁定);
            Assert.True(locked.锁定到期 is { } d && d > DateTime.Now);

            // 解锁 → 已锁定 false
            Assert.True(await svc.UnlockAsync("ACCT_T1"));
            var unlocked = (await svc.ListAsync("ACCT_T1")).Single(r => r.用户 == "ACCT_T1");
            Assert.False(unlocked.已锁定);

            // 删除 → 列表不含
            Assert.True(await svc.DeleteAsync("ACCT_T1"));
            var after = await svc.ListAsync("ACCT_T1");
            Assert.Empty(after);
        }
        finally
        {
            Clean();
        }
    }
}
