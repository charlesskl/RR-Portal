using Dapper;
using ErpApi.Features.SystemConfig;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SysConfigServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private static SysConfigService Svc()
    {
        Environment.SetEnvironmentVariable("ERP_CONFIG_KEY", "test-config-key-0123456789abcdef");
        return new SysConfigService(Factory(), new ConfigProtector());
    }

    [SkippableFact]
    public async Task Upsert_明文_加密脱敏_空值保留旧密文_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean() => c.Execute("DELETE FROM [系统配置表] WHERE [键] IN ('P8K1','P8K2')");
        Clean();
        try
        {
            // 明文键
            await Svc().UpsertAsync(new SysConfigDto { 键 = "P8K1", 值 = "hello", 是否加密 = false }, "tester");
            var k1 = await Svc().GetAsync("P8K1");
            Assert.NotNull(k1);
            Assert.Equal("hello", k1!.值);

            // 加密键
            await Svc().UpsertAsync(new SysConfigDto { 键 = "P8K2", 值 = "secret", 是否加密 = true }, "tester");
            var k2 = await Svc().GetAsync("P8K2");
            Assert.NotNull(k2);
            Assert.True(k2!.是否加密);
            Assert.Null(k2.值);  // 读时脱敏

            var raw = c.ExecuteScalar<string?>("SELECT [值] FROM [系统配置表] WHERE [键]='P8K2'");
            Assert.NotNull(raw);
            Assert.NotEqual("secret", raw);  // 库内为密文

            Assert.Equal("secret", await Svc().GetValueAsync("P8K2"));  // 服务端取明文

            // 加密键再保存空值 → 保留旧密文
            await Svc().UpsertAsync(new SysConfigDto { 键 = "P8K2", 值 = "", 是否加密 = true, 备注 = "改备注" }, "tester");
            Assert.Equal("secret", await Svc().GetValueAsync("P8K2"));
            var k2b = await Svc().GetAsync("P8K2");
            Assert.Equal("改备注", k2b!.备注);

            // 删除
            Assert.True(await Svc().DeleteAsync("P8K1"));
            Assert.True(await Svc().DeleteAsync("P8K2"));
            Assert.Null(await Svc().GetAsync("P8K1"));
            Assert.Null(await Svc().GetAsync("P8K2"));
        }
        finally { Clean(); }
    }
}
