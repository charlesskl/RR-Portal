using Dapper;
using ErpApi.Features.Plastics.PlasticCommonMaterial;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticCommonMaterialDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticCommonMaterialService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶共用物料表]([客户],[塑胶货号],[工模编号],[物料名称],[颜色],[用料名称],[加工单价],[用量],[物料编号],[调整审核])
            VALUES(N'TONY',N'PG001',N'M01',N'黑色车头壳',N'黑色',N'ABS',5,1.5,N'PM001',N'1'),
                  (N'TONY',N'PG001',N'M02',N'后壳',N'白色',N'ABS',6,2.0,N'PM002',N'0'),
                  (N'KING',N'PG002',N'M01',N'面壳',N'红色',N'PP',4,1.0,N'PM003',N'1')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号] IN (N'PM001',N'PM002',N'PM003')");

    [SkippableFact]
    public async Task List_filters_by_塑胶货号()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "PG001", null, null, null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("PG001", r.塑胶货号));
            Assert.Contains(page.Items, r => r.物料编号 == "PM001" && r.工模编号 == "M01" && r.用量 == 1.5m);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_客户_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var byCust = await Svc().ListAsync("KING", null, null, null, null, 1, 20);
            Assert.Equal("PG002", Assert.Single(byCust.Items).塑胶货号);
            var byKw = await Svc().ListAsync(null, null, null, "面壳", null, 1, 20);
            Assert.Equal("PM003", Assert.Single(byKw.Items).物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_审核情况()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var approved = await Svc().ListAsync(null, "PG001", null, null, "已审核", 1, 20);
            Assert.Equal("PM001", Assert.Single(approved.Items).物料编号);
            var unapproved = await Svc().ListAsync(null, "PG001", null, null, "未审核", 1, 20);
            Assert.Equal("PM002", Assert.Single(unapproved.Items).物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_carries_new_p40_columns()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号] = N'PM040'");
        c.Execute(@"INSERT INTO [塑胶共用物料表]([塑胶货号],[物料编号],[出模数],[套数],[用量],[水口比例],[整啤毛重],[模具日产量],[啤机机型],[啤机价钱],[胶件啤工价],[胶料单价],[原胶料单价],[加工总单价],[其它成本],[二次加工内容])
            VALUES(N'PG040',N'PM040',3,1.5,2,0.1,120,5000,N'120T',300,0.5,12,11,7,0.8,N'喷油')");
        try
        {
            var page = await Svc().ListAsync(null, "PG040", null, null, null, 1, 20);
            var r = Assert.Single(page.Items);
            Assert.Equal(3m, r.出模数);
            Assert.Equal(1.5m, r.套数);
            Assert.Equal(2m, r.用量);
            Assert.Equal(0.1m, r.水口比例);
            Assert.Equal(120m, r.整啤毛重);
            Assert.Equal(5000m, r.模具日产量);
            Assert.Equal("120T", r.啤机机型);
            Assert.Equal(300m, r.啤机价钱);
            Assert.Equal(0.5m, r.胶件啤工价);
            Assert.Equal(12m, r.胶料单价);
            Assert.Equal(11m, r.原胶料单价);
            Assert.Equal(7m, r.加工总单价);
            Assert.Equal(0.8m, r.其它成本);
            Assert.Equal("喷油", r.二次加工内容);
        }
        finally { c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号] = N'PM040'"); }
    }

    [SkippableFact]
    public async Task 工模编号存在性校验_查工模表()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [工模表] WHERE [工模编号] = N'MT-LINK1'");
        c.Execute("INSERT INTO [工模表]([工模编号],[工模名称]) VALUES(N'MT-LINK1',N'联动测试模')");
        try
        {
            // 存在(含小写输入,比较前规范化大写)与留空均放行
            Assert.Null(await 塑胶共用物料校验.校验工模编号存在(Factory(), "MT-LINK1"));
            Assert.Null(await 塑胶共用物料校验.校验工模编号存在(Factory(), "mt-link1"));
            Assert.Null(await 塑胶共用物料校验.校验工模编号存在(Factory(), null));
            Assert.Null(await 塑胶共用物料校验.校验工模编号存在(Factory(), "  "));
            // 不存在 → 中文 400 文案
            Assert.Equal(塑胶共用物料校验.工模编号不存在消息,
                await 塑胶共用物料校验.校验工模编号存在(Factory(), "MT-NO-SUCH"));
        }
        finally { c.Execute("DELETE FROM [工模表] WHERE [工模编号] = N'MT-LINK1'"); }
    }
}
