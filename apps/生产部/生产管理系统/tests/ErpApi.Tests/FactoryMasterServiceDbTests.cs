using Dapper;
using ErpApi.Features.Materials.FactoryMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FactoryMasterServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private FactoryMasterService Svc() => new(Factory());

    // 类A 一行(带传真 F1、联系人 张)、类B 一行。加工厂编号 UNIQUE → 用唯一 FAC-T1/FAC-T2。
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [加工厂资料]([加工厂类别],[加工厂编号],[加工厂名称],[联系人],[传真])
                    VALUES(N'类A',N'FAC-T1',N'厂甲',N'张',N'F1');
                    INSERT INTO [加工厂资料]([加工厂类别],[加工厂编号],[加工厂名称])
                    VALUES(N'类B',N'FAC-T2',N'厂乙');");
    }

    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号] IN (N'FAC-T1',N'FAC-T2')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            Assert.Contains(cats, x => x.类别 == "类A" && x.数量 >= 1);
            Assert.Contains(cats, x => x.类别 == "类B" && x.数量 >= 1);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_category_brings_fax()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync("类A", null, 1, 50);
            var row = Assert.Single(page.Items);
            Assert.Equal("FAC-T1", row.加工厂编号);
            Assert.Equal("F1", row.传真);
            Assert.Equal("张", row.联系人);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_keyword_on_name()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "厂乙", 1, 50);
            var row = Assert.Single(page.Items);
            Assert.Equal("FAC-T2", row.加工厂编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_unknown_category_returns_empty()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync("类不存在", null, 1, 50);
            Assert.Equal(0, page.Total);
        }
        finally { Cleanup(c); }
    }
}
