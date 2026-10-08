using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class StyleServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Svc() => new(Factory(), Ctx());

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [款号颜色表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号尺码表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号明细表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2STYLE1'");
    }

    [SkippableFact]
    public async Task Replace_colors_and_sizes_then_get_full_aggregate()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using (var c = fx.Open())
        {
            c.Execute("INSERT INTO [款号总表]([款号],[款式],[单价]) VALUES(N'P2STYLE1',N'P2测试款',100)");
            c.Execute(@"INSERT INTO [款号明细表]([款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                        VALUES(N'P2STYLE1',N'P2测试款',N'01',N'裁床',1.5,N'裁床')");
        }

        var svc = Svc();
        // 整组替换颜色（2个）和尺码（3个，顺序必须保持 S,M,L）
        await svc.ReplaceColorsAsync("P2STYLE1",
            [new StyleColorDto("C01", "黑色"), new StyleColorDto("C02", "白色")]);
        await svc.ReplaceSizesAsync("P2STYLE1", ["S", "M", "L"]);

        var full = await svc.GetFullAsync("P2STYLE1");
        Assert.NotNull(full);
        Assert.Equal("P2测试款", full!.主档.款式);
        Assert.Equal(2, full.颜色.Count);
        Assert.Equal(["S", "M", "L"], full.尺码);   // 顺序保持(按写入的ID排序)
        Assert.Single(full.工序);
        Assert.Equal("裁床", full.工序[0].工序名称);

        // 再次替换 = 覆盖（不是追加）
        await svc.ReplaceColorsAsync("P2STYLE1", [new StyleColorDto("C03", "红色")]);
        full = await svc.GetFullAsync("P2STYLE1");
        Assert.Single(full!.颜色);
        Assert.Equal("红色", full.颜色[0].颜色名称);

        Cleanup();
    }

    [SkippableFact]
    public async Task GetFull_returns_null_for_missing_style()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var full = await Svc().GetFullAsync("不存在的款号XX");
        Assert.Null(full);
    }

    [SkippableFact]
    public async Task Replace_colors_throws_for_missing_style()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc().ReplaceColorsAsync("不存在的款号XX", [new StyleColorDto("C1", "黑色")]));
    }
}
