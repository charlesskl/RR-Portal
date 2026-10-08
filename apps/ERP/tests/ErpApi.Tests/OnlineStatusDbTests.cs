using Dapper;
using ErpApi.Features.Admin;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OnlineStatusDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private static AuthService AuthSvc()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>{
            ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB",
            ["Erp:Jwt:Issuer"]="ErpApi", ["Erp:Jwt:Audience"]="ErpClient", ["Erp:Jwt:ExpireMinutes"]="480"
        }).Build();
        return new AuthService(Factory(), new BcryptPasswordHasher(), new JwtTokenService(cfg), cfg);
    }

    [SkippableFact]
    public async Task Heartbeat_logout_drives_three_state_status()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var auth = AuthSvc();
        var accounts = new AccountService(Factory(), new BcryptPasswordHasher());
        using var c = fx.Open();
        const string u = "ONLINE_T1";
        void Clean()
        {
            c.Execute("DELETE FROM [sysfileuser] WHERE [用户]=@u", new { u });
        }
        Clean();
        c.Execute("INSERT INTO [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@u,N'x',N'',0)", new { u });
        try
        {
            // 无心跳 → 离线
            var row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("离线", row.在线状态);

            // 有心跳但无活动时间(纯挂机) → 忙线
            await auth.HeartbeatAsync(u, false);
            row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("忙线", row.在线状态);

            // 带活动标记的心跳 → 在线
            await auth.HeartbeatAsync(u, true);
            row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("在线", row.在线状态);
            Assert.NotNull(row.最后心跳时间);
            Assert.NotNull(row.最后活动时间);

            // 活动时间超过 10 分钟(心跳仍新) → 忙线
            c.Execute("UPDATE [sysfileuser] SET [最后活动时间]=DATEADD(MINUTE,-11,GETDATE()) WHERE [用户]=@u", new { u });
            row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("忙线", row.在线状态);

            // 心跳超过 3 分钟 → 离线
            c.Execute("UPDATE [sysfileuser] SET [最后心跳时间]=DATEADD(MINUTE,-4,GETDATE()) WHERE [用户]=@u", new { u });
            row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("离线", row.在线状态);

            // 退出登录 → 立即离线(清心跳)
            await auth.HeartbeatAsync(u, true);
            await auth.LogoutAsync(u);
            row = (await accounts.ListAsync(u)).Single(r => r.用户 == u);
            Assert.Equal("离线", row.在线状态);
            Assert.Null(row.最后心跳时间);
            Assert.Equal("", row.登录状态);
        }
        finally
        {
            Clean();
        }
    }
}
