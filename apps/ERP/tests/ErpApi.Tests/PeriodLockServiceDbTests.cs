using Dapper;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PeriodLockServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task IsLocked_按口径仓库年月判定()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string wh = "PL锁仓";
        using var c = fx.Open();
        c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
        try
        {
            c.Execute(@"INSERT INTO [结存快照表]([年月],[仓库],[口径],[物料编号],[期初],[本期入],[本期出],[结存],[生成时间])
                        VALUES('202602',@wh,N'物料',N'X1',0,0,0,0,SYSUTCDATETIME())", new { wh });
            var svc = new PeriodLockService(Factory());
            using var cc = fx.Open();
            Assert.True (await svc.IsLockedAsync("物料", wh, new DateTime(2026,2,15), cc));
            Assert.True (await svc.IsLockedAsync("物料", wh, new DateTime(2026,1,10), cc));
            Assert.False(await svc.IsLockedAsync("物料", wh, new DateTime(2026,3,10), cc));
            Assert.False(await svc.IsLockedAsync("成品", wh, new DateTime(2026,2,15), cc));
            Assert.False(await svc.IsLockedAsync("物料", "别的仓", new DateTime(2026,2,15), cc));
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            Assert.False(await svc.IsLockedAsync("物料", wh, new DateTime(2026,2,15), cc));
        }
        finally { c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh }); }
    }
}
